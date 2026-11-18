import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './figma-fixture.mjs';
test('RTL patch sets native text alignment, line height and explicit row order',async()=>{
 const f=await fixture();
 const created=await f.execute({id:'rtl-create',name:'figma_create',pageId:'0:1',args:{scene:{type:'FRAME',layout:'HORIZONTAL',children:[{type:'TEXT',text:'يمين'},{type:'TEXT',text:'يسار'}]}}});
 const [root,right,left]=created.createdNodeIds;
 const result=await f.execute({id:'rtl-patch',name:'figma_patch',pageId:'0:1',args:{rootId:root,changes:[{nodeId:root,props:{childOrder:[left,right],paddingRight:12}},{nodeId:right,props:{textAlign:'RIGHT',lineHeight:22}}]}});
 assert.equal(result.ok,true);assert.deepEqual(f.nodes.get(root).children.map(n=>n.id),[left,right]);
 assert.equal(f.nodes.get(right).textAlignHorizontal,'RIGHT');assert.equal(f.nodes.get(right).lineHeight.unit,'PIXELS');assert.equal(f.nodes.get(right).lineHeight.value,22);
 const outside=f.figma.createRectangle();
 const rejected=await f.execute({id:'rtl-outside',name:'figma_patch',pageId:'0:1',args:{rootId:root,changes:[{nodeId:outside.id,props:{x:999}}]}});
 assert.equal(rejected.ok,false);assert.equal(outside.x,0);
});
