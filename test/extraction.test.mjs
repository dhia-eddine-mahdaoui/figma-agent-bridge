import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './figma-fixture.mjs';
import { validateTool } from '../contracts.mjs';
import { saveAsset } from '../assets.mjs';
let requestIndex=0;
const read=(f,name,args)=>f.execute({id:`extract-${++requestIndex}`,pageId:f.page.id,name,args});

test('section outline is paged, small, scoped, and does not dump sibling sections',async()=>{
  const f=await fixture(),root=f.figma.createFrame(),other=f.figma.createFrame();root.name='Selected screen';other.name='Unrelated screen';
  for(let i=0;i<30;i++){const section=f.figma.createFrame();section.name=`Section ${i}`;root.appendChild(section);}
  const before=f.nodes.size;let cursor,ids=[];
  do {
    const result=await read(f,'figma_outline',{nodeId:root.id,limit:5,maxChars:2000,...(cursor?{cursor}: {})});
    assert.equal(result.ok,true);assert.ok(JSON.stringify(result).length<=2000);assert.ok(result.nodes.length<=5);
    assert.ok(result.nodes.every(node=>!('fills' in node)&&!('text' in node)&&node.id!==other.id));
    ids.push(...result.nodes.map(node=>node.id));cursor=result.nextCursor;
  }while(cursor);
  assert.equal(ids.length,31);assert.equal(new Set(ids).size,31);assert.equal(f.nodes.size,before);
  const page=await read(f,'figma_outline',{nodeId:root.id,limit:2});
  root.children[0].name='Changed outline';
  const stale=await read(f,'figma_outline',{nodeId:root.id,limit:2,cursor:page.nextCursor});assert.equal(stale.ok,false);assert.match(stale.error,/changed/i);
});
test('selected fields expose native styles/layout and instances without eager CSS or serializing node handles',async()=>{
  const f=await fixture(),root=f.figma.createFrame();
  root.fills=[{type:'GRADIENT_LINEAR',gradientTransform:[[1,0,0],[0,1,0]],gradientStops:[{position:0,color:{r:1,g:0,b:0,a:1}},{position:1,color:{r:0,g:0,b:1,a:0.5}}]}];
  root.effects=[{type:'DROP_SHADOW',radius:12,spread:2,offset:{x:0,y:4},color:{r:0,g:0,b:0,a:0.2},visible:true}];
  root.strokes=[{type:'SOLID',color:{r:0,g:1,b:0}}];root.cornerRadius=16;root.layoutMode='HORIZONTAL';root.layoutWrap='WRAP';root.primaryAxisAlignItems='SPACE_BETWEEN';root.minWidth=200;
  root.boundVariables={cornerRadius:{type:'VARIABLE_ALIAS',id:'radius:1'}};
  let cssReads=0;root.getCSSAsync=async()=>{cssReads++;return {'border-radius':'16px'};};
  const main=f.figma.createComponent(),instance=main.createInstance();root.appendChild(instance);
  instance.getMainComponentAsync=async()=>main;instance.variantProperties={Size:'Large'};instance.componentProperties={Label:{type:'TEXT',value:'Continue'}};instance.exposedInstances=[instance];
  const detailed=await read(f,'figma_inspect',{nodeId:root.id,fields:['appearance','layout','components','variables']});
  assert.equal(detailed.ok,true);assert.equal(cssReads,0);
  const first=detailed.nodes[0];assert.equal(first.appearance.cornerRadius,16);assert.equal(first.appearance.effects[0].radius,12);assert.equal(first.appearance.fills[0].gradientStops.length,2);
  assert.equal(first.layout.primaryAxisAlignItems,'SPACE_BETWEEN');assert.equal(first.variables.boundVariables.cornerRadius.id,'radius:1');
  assert.equal(detailed.nodes[1].components.main.id,main.id);assert.equal(detailed.nodes[1].components.variantProperties.Size,'Large');
  const css=await read(f,'figma_inspect',{nodeId:root.id,depth:0,fields:['css']});assert.equal(cssReads,1);assert.equal(css.nodes[0].css['border-radius'],'16px');assert.ok(!css.nodes[0].appearance);
});
test('hard response cap flags oversized fields and hidden/deep branches stay opt-in',async()=>{
  const f=await fixture(),root=f.figma.createFrame(),hidden=f.figma.createFrame();root.appendChild(hidden);hidden.visible=false;
  root.effects=Array.from({length:100},()=>({type:'DROP_SHADOW',radius:10,color:{r:0,g:0,b:0,a:0.5},offset:{x:0,y:0},description:'x'.repeat(100)}));
  const result=await read(f,'figma_inspect',{nodeId:root.id,maxChars:2000,fields:['appearance']});
  assert.ok(JSON.stringify(result).length<=2000);assert.deepEqual(result.nodes[0].omittedFields,['appearance']);assert.equal(result.skippedHidden,1);assert.ok(!result.nodes.some(node=>node.id===hidden.id));
  const included=await read(f,'figma_outline',{nodeId:root.id,includeHidden:true});assert.ok(included.nodes.some(node=>node.id===hidden.id));
});
test('full mixed text is retrieved without gaps or duplicated characters under the response cap',async()=>{
  const f=await fixture(),text=f.figma.createText();text._characters=('😀 Arabic العربية and escaped "text"\n').repeat(100);text.fontName=f.figma.mixed;
  text.getStyledTextSegments=(fields,start=0,end=text.characters.length)=>{
    const ranges=[{start:0,end:50,fontName:{family:'Inter',style:'Bold'}},{start:50,end:text.characters.length,fontName:{family:'Inter',style:'Regular'}}];
    return ranges.filter(range=>range.end>start&&range.start<end).map(range=>({...range,start:Math.max(start,range.start),end:Math.min(end,range.end),characters:text.characters.slice(Math.max(start,range.start),Math.min(end,range.end)),fontSize:16,lineHeight:{unit:'PIXELS',value:24}}));
  };
  let start=0,reconstructed='',pages=0;
  do{
    const result=await read(f,'figma_text',{nodeId:text.id,start,length:8000,maxChars:2000,styled:true});
    assert.equal(result.ok,true);assert.ok(JSON.stringify(result).length<=2000);assert.ok(result.end>start);assert.ok(result.runs.every(run=>!Object.hasOwn(run,'characters')));
    assert.ok(!/[\uD800-\uDBFF]$/.test(result.text));reconstructed+=result.text;start=result.nextStart;assert.ok(++pages<100);
  }while(start!==null);
  assert.equal(reconstructed,text.characters);
  const tiny=await read(f,'figma_text',{nodeId:text.id,length:1});assert.equal(tiny.text,'😀');assert.equal(tiny.nextStart,2);
});
test('requested token IDs resolve for the consumer and paginate instead of dumping libraries',async()=>{
  const f=await fixture(),root=f.figma.createFrame();let ids=[];
  f.figma.variables.getVariableByIdAsync=async id=>{ids.push(id);return {id,name:id,resolvedType:'COLOR',variableCollectionId:'collection:1',valuesByMode:{light:{r:1,g:1,b:1},dark:{type:'VARIABLE_ALIAS',id:'palette:1'}},description:'x'.repeat(300),resolveForConsumer:()=>({resolvedType:'COLOR',value:{r:0,g:0,b:0}})};};
  f.figma.variables.getVariableCollectionByIdAsync=async()=>({id:'collection:1',name:'Theme',modes:[{modeId:'light',name:'Light'},{modeId:'dark',name:'Dark'}],defaultModeId:'light'});
  const requested=Array.from({length:10},(_,i)=>`color:${i}`);let offset=0,results=[];
  do{const result=await read(f,'figma_tokens',{ids:requested,nodeId:root.id,offset,maxChars:2000});assert.ok(JSON.stringify(result).length<=2000);results.push(...result.variables);offset=result.nextOffset;}while(offset!==null);
  assert.deepEqual(results.map(variable=>variable.id),requested);assert.equal(results[0].resolved.value.r,0);assert.equal(results[0].collection.modes.length,2);assert.ok(ids.every(id=>requested.includes(id)));
});
test('original image transfers save exact bytes locally; SVG exports return paths without base64 context',async t=>{
  const f=await fixture(),node=f.figma.createRectangle();node.fills=[{type:'IMAGE',imageHash:'source-image',scaleMode:'CROP',imageTransform:[[1,0,0],[0,1,0]]}];
  const original=Buffer.alloc(1300000,17);original.set([137,80,78,71,13,10,26,10]);let reads=0;
  f.figma.getImageByHash=()=>({getBytesAsync:async()=>{reads++;return new Uint8Array(original);}});
  const data=await mkdtemp(join(tmpdir(),'figma assets '));t.after(()=>rm(data,{recursive:true,force:true}));
  const result=await saveAsset({nodeId:node.id,format:'ORIGINAL'},(name,args)=>read(f,name,args),data);
  assert.deepEqual(await readFile(result.filePath),original);assert.equal(reads,1);assert.equal(result.mimeType,'image/png');assert.ok(!('data' in result));assert.ok(JSON.stringify(result).length<1000);
  node.exportAsync=async settings=>{assert.equal(settings.format,'SVG');return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');};
  const svg=await saveAsset({nodeId:node.id,format:'SVG'},(name,args)=>read(f,name,args),data);assert.equal(svg.mimeType,'image/svg+xml');assert.match(await readFile(svg.filePath,'utf8'),/^<svg/);
  const tooLarge=await read(f,'figma_asset',{nodeId:node.id,format:'ORIGINAL',maxBytes:1024});assert.equal(tooLarge.ok,false);assert.match(tooLarge.error,/maxBytes/);
});
test('incomplete asset data is rejected and extraction inputs remain bounded',async t=>{
  const data=await mkdtemp(join(tmpdir(),'figma bad asset '));t.after(()=>rm(data,{recursive:true,force:true}));
  await assert.rejects(saveAsset({nodeId:'x'},async()=>({ok:true,nodeId:'x',pageId:'page',mimeType:'image/png',format:'PNG',byteLength:20,transferId:'x',offset:0,nextOffset:null,data:Buffer.from('short').toString('base64')}),data),/Incomplete/);
  assert.deepEqual(await readdir(data),[]);
  assert.throws(()=>validateTool('figma_inspect',{nodeId:'x',fields:[]}));assert.throws(()=>validateTool('figma_inspect',{nodeId:'x',maxChars:50000}));
  assert.throws(()=>validateTool('figma_text',{nodeId:'x',length:100000}));assert.throws(()=>validateTool('figma_asset',{nodeId:'x',maxBytes:99999999}));
});
