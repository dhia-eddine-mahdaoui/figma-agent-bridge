import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './figma-fixture.mjs';
import {mcpTools,TOOLS,validateTool,editingSchema,resolveEdit} from '../contracts.mjs';

function expand(reply) {
  const deref=value=>value && value.$ref ? reply.sharedStyles[value.$ref] : value;
  return reply.nodes.map(node=>{
    const result={...node};for(const field of ['layout','appearance','components','variables','css'])if(result[field])result[field]=deref(result[field]);
    if(result.text){const {style,...text}=result.text;result.text={...text,...deref(style)};}
    return result;
  });
}
test('compact reads reduce repeated styling without losing editable values',async()=>{
  const f=await fixture(),root=f.figma.createFrame();
  for(let i=0;i<12;i++){const node=f.figma.createText();root.appendChild(node);node._characters=`Item ${i}`;node.fontName={family:'Inter',style:'Regular'};node.lineHeight={unit:'PIXELS',value:24};node.letterSpacing={unit:'PIXELS',value:0};node.textAlignHorizontal='LEFT';node.paragraphSpacing=0;node.fills=[{type:'SOLID',color:{r:0.1,g:0.2,b:0.3},opacity:1}];}
  const request=(id,args)=>f.execute({id,pageId:f.page.id,name:'figma_inspect',args:{nodeId:root.id,fields:['text','appearance'],depth:1,maxChars:24000,...args}});
  const full=await request('native',{compact:false});const packed=await request('packed',{});
  assert.ok(packed.sharedStyles);assert.deepEqual(expand(packed),full.nodes);
  assert.ok(JSON.stringify(packed).length<JSON.stringify(full).length*0.8);
  const defaultRead=await f.execute({id:'default',pageId:f.page.id,name:'figma_inspect',args:{nodeId:root.id}});assert.ok(JSON.stringify(defaultRead).length<=8000);
});
test('lean menu preserves every editing operation with strict validation on demand',()=>{
  const lean=mcpTools(),full=mcpTools(true);
  assert.ok(JSON.stringify(lean).length<JSON.stringify(full).length*0.65);
  assert.ok(lean.some(tool=>tool.name==='figma_edit'));assert.ok(lean.some(tool=>tool.name==='figma_schema'));
  for(const [operation,args,canonical]of [
    ['create',{scene:{type:'FRAME',children:[{type:'TEXT',text:'Hello'}]}},'figma_create'],
    ['update',{nodeId:'1:1',props:{text:'Hello',fontSize:18}},'figma_update'],
    ['patch',{rootId:'1:1',changes:[{nodeId:'1:2',props:{fill:'#FFFFFF'}}]},'figma_patch'],
    ['replace_children',{nodeId:'1:1',children:[{type:'TEXT',text:'Paragraph'}]},'figma_replace_children'],
  ]){
    const input={operation,requestId:'unique',...args};validateTool('figma_edit',input);assert.deepEqual(resolveEdit(input),{name:canonical,args:{requestId:'unique',...args}});
    assert.deepEqual(editingSchema({operation}).inputSchema,TOOLS.find(tool=>tool.name===canonical).inputSchema);
  }
  assert.throws(()=>validateTool('figma_edit',{operation:'update',requestId:'x',nodeId:'1:1',props:{code:'eval'}}));
  assert.throws(()=>validateTool('figma_edit',{operation:'create',requestId:'x',props:{fill:'#FFFFFF'}}));
  assert.deepEqual(Object.keys(editingSchema({operation:'update',fields:['fill','width']}).properties),['fill','width']);
  assert.throws(()=>editingSchema({operation:'update',fields:['unsupported']}));
});
test('one lean edit call executes the existing native provider behavior',async()=>{
  const f=await fixture();const input={operation:'create',requestId:'one',scene:{type:'FRAME',children:[{type:'TEXT',text:'Editable'}]}};
  const resolved=resolveEdit(input);const created=await f.execute({id:'edit',pageId:f.page.id,...resolved});assert.equal(created.ok,true);
  const update=resolveEdit({operation:'update',requestId:'two',nodeId:created.createdNodeIds[1],props:{text:'Still editable'}});
  const edited=await f.execute({id:'edit-2',pageId:f.page.id,...update});assert.equal(edited.ok,true);assert.equal(f.nodes.get(created.createdNodeIds[1]).characters,'Still editable');
});
