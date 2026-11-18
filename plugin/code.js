/* Local Figma execution provider. No remote MCP, arbitrary eval, or API tokens. */
const expandedPanel = { width: 360, height: 470 };
figma.showUI(__html__, { ...expandedPanel, themeColors: true });
const completed = new Map();
let busy = false;
const loadedFonts = new Map();
function loadFont(font) { const key=font.family+'|'+font.style; if(!loadedFonts.has(key)) loadedFonts.set(key,figma.loadFontAsync(font).catch(error=>{loadedFonts.delete(key);throw error;})); return loadedFonts.get(key); }

function assert(condition, message) { if (!condition) throw new Error(message); }
function paint(hex) {
  assert(/^#[0-9a-fA-F]{6}$/.test(hex), 'Expected #RRGGBB');
  return [{ type: 'SOLID', color: { r: parseInt(hex.slice(1,3),16)/255, g: parseInt(hex.slice(3,5),16)/255, b: parseInt(hex.slice(5,7),16)/255 } }];
}
function onPage(node) {
  let current = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current && current.id === figma.currentPage.id;
}
async function getNode(id) {
  const node = await figma.getNodeByIdAsync(id);
  assert(node && onPage(node), 'Node is missing or outside the paired current page');
  return node;
}
async function loadFonts(node) {
  if (node.type === 'TEXT') {
    for (const segment of node.getStyledTextSegments(['fontName'])) await loadFont(segment.fontName);
    if (!node.characters && node.fontName !== figma.mixed) await loadFont(node.fontName);
  }
  if ('children' in node) for (const child of node.children) await loadFonts(child);
}
const textProps = ['text', 'fontFamily', 'fontStyle', 'fontSize','textAlign','lineHeight','textAutoResize'];
const frameProps = ['layout', 'gap', 'padding','paddingTop','paddingRight','paddingBottom','paddingLeft','primaryAxisAlign','counterAxisAlign'];
const allowedProps = ['name','width','height','x','y','fill','fillVariableId','cornerRadius','opacity','imageBase64','imageScaleMode','clipsContent','stroke','strokeWeight', ...textProps, ...frameProps, 'sizingHorizontal','sizingVertical','childOrder'];
function validateProps(node, props) {
  for (const key of Object.keys(props)) assert(allowedProps.includes(key), `Unsupported property: ${key}`);
  for (const key of textProps) if (key in props) assert(node.type === 'TEXT', `${key} requires TEXT`);
  for (const key of frameProps) if (key in props) assert(node.type === 'FRAME' || node.type === 'COMPONENT', `${key} requires FRAME or COMPONENT`);
  if ('cornerRadius' in props) assert('cornerRadius' in node, 'Node has no corner radius');
  if ('imageBase64' in props) assert('fills' in node,'Image requires a node with fills');
  if ('clipsContent' in props) assert('clipsContent' in node,'Clipping requires a frame');
  if ('stroke' in props || 'strokeWeight' in props) assert('strokes' in node,'Stroke requires a shape');
  if ('fill' in props) assert('fills' in node, 'Node cannot have fills');
  if('childOrder' in props) {
    assert('children' in node,'Node has no children');
    assert(props.childOrder.length===node.children.length && new Set(props.childOrder).size===node.children.length && props.childOrder.every(id=>node.children.some(n=>n.id===id)),'childOrder must contain every existing direct child exactly once');
  }
  for (const key of ['sizingHorizontal','sizingVertical']) {
    if (props[key] === 'FILL') assert(node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE', 'FILL needs an auto-layout parent');
    if (props[key] === 'HUG') assert(((node.type === 'FRAME' || node.type === 'COMPONENT') && (props.layout || node.layoutMode) !== 'NONE') || (node.type === 'TEXT' && node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE'), 'HUG needs an auto-layout frame or text inside auto layout');
  }
}
async function applyProps(node, props) {
  validateProps(node, props);
  await loadFonts(node);
  if (node.type === 'TEXT' && (props.fontFamily || props.fontStyle)) {
    assert(node.fontName !== figma.mixed || props.fontFamily, 'Mixed-font text requires an explicit fontFamily');
    const font = { family: props.fontFamily || node.fontName.family, style: props.fontStyle || 'Regular' };
    await loadFont(font); node.fontName = font;
  }
  if ('name' in props) node.name = props.name;
  if ('layout' in props) node.layoutMode = props.layout;
  if ('gap' in props) node.itemSpacing = props.gap;
  if ('padding' in props) for (const key of ['paddingTop','paddingRight','paddingBottom','paddingLeft']) node[key] = props.padding;
  for(const key of ['paddingTop','paddingRight','paddingBottom','paddingLeft'])if(key in props)node[key]=props[key];
  if('primaryAxisAlign' in props)node.primaryAxisAlignItems=props.primaryAxisAlign;
  if('counterAxisAlign' in props)node.counterAxisAlignItems=props.counterAxisAlign;
  if ('width' in props || 'height' in props) {
    if (node.type === 'TEXT' && 'width' in props) node.textAutoResize = 'HEIGHT';
    node.resize(props.width || node.width, props.height || node.height);
  }
  if ('fill' in props) node.fills = paint(props.fill);
  if ('imageBase64' in props) {
    const image=figma.createImage(figma.base64Decode(props.imageBase64));
    node.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:props.imageScaleMode || 'FILL'}];
  }
  if ('clipsContent' in props) node.clipsContent=props.clipsContent;
  if ('stroke' in props) node.strokes=paint(props.stroke);
  if ('strokeWeight' in props) node.strokeWeight=props.strokeWeight;
  if ('fillVariableId' in props) {
    const variable = await figma.variables.getVariableByIdAsync(props.fillVariableId);
    assert(variable && variable.resolvedType === 'COLOR', 'fillVariableId must identify a COLOR variable');
    assert('fills' in node, 'Node cannot have fills');
    const base = node.fills !== figma.mixed && node.fills.find(p => p.type === 'SOLID') || paint('#000000')[0];
    node.fills = [figma.variables.setBoundVariableForPaint(base, 'color', variable)];
  }
  if ('cornerRadius' in props) node.cornerRadius = props.cornerRadius;
  if ('opacity' in props) node.opacity = props.opacity;
  if ('fontSize' in props) node.fontSize = props.fontSize;
  if ('text' in props) node.characters = props.text;
  if('textAlign' in props)node.textAlignHorizontal=props.textAlign;
  if('lineHeight' in props)node.lineHeight={unit:'PIXELS',value:props.lineHeight};
  if('textAutoResize' in props)node.textAutoResize=props.textAutoResize;
  if('childOrder' in props)for(let i=0;i<props.childOrder.length;i++)node.insertChild(i,node.children.find(n=>n.id===props.childOrder[i]));
  if ('x' in props) node.x = props.x;
  if ('y' in props) node.y = props.y;
  if ('sizingHorizontal' in props) node.layoutSizingHorizontal = props.sizingHorizontal;
  if ('sizingVertical' in props) node.layoutSizingVertical = props.sizingVertical;
}
async function preflight(scene, depth = 0, counter = { n: 0 }) {
  assert(depth <= 10 && ++counter.n <= 200, 'Scene exceeds depth/node budget');
  assert(['FRAME','COMPONENT','TEXT','RECTANGLE','ELLIPSE','INSTANCE'].includes(scene.type), 'Unsupported node type');
  assert(!scene.children || scene.type === 'FRAME' || scene.type === 'COMPONENT', 'Only FRAME or COMPONENT can declare children');
  if (scene.type === 'TEXT') await loadFont({ family: scene.fontFamily || 'Inter', style: scene.fontStyle || 'Regular' });
  if (scene.type === 'INSTANCE') assert(Boolean(scene.componentId) !== Boolean(scene.componentKey), 'INSTANCE needs exactly one componentId or componentKey');
  for (const child of scene.children || []) await preflight(child, depth + 1, counter);
}
async function createNode(scene, parent, created) {
  let node;
  if (scene.type === 'INSTANCE') {
    const component = scene.componentId ? await getNode(scene.componentId) : await figma.importComponentByKeyAsync(scene.componentKey);
    assert(component.type === 'COMPONENT', 'componentId must point to a COMPONENT, not a COMPONENT_SET');
    await loadFonts(component); node = component.createInstance();
  } else {
    node = ({ FRAME: () => figma.createFrame(), COMPONENT: () => figma.createComponent(), TEXT: () => figma.createText(), RECTANGLE: () => figma.createRectangle(), ELLIPSE: () => figma.createEllipse() })[scene.type]();
  }
  created.push(node.id);
  await loadFonts(node);
  parent.appendChild(node);
  if (node.type === 'FRAME' || node.type === 'COMPONENT') { node.layoutMode = 'VERTICAL'; node.primaryAxisSizingMode = 'AUTO'; node.counterAxisSizingMode = 'AUTO'; }
  if (node.type === 'TEXT') { await loadFont({ family: scene.fontFamily || 'Inter', style: scene.fontStyle || 'Regular' }); node.fontName = { family: scene.fontFamily || 'Inter', style: scene.fontStyle || 'Regular' }; node.textAutoResize = 'WIDTH_AND_HEIGHT'; }
  const props = {};
  for (const key of allowedProps) if (key in scene) props[key] = scene[key];
  await applyProps(node, props);
  for (const child of scene.children || []) await createNode(child, node, created);
  return node;
}
function summary(node) {
  const out = { id: node.id, name: node.name, type: node.type };
  out.parentId=node.parent ? node.parent.id : null;
  if('absoluteBoundingBox' in node)out.absolute=node.absoluteBoundingBox;
  if ('width' in node) { out.width = node.width; out.height = node.height; out.x = node.x; out.y = node.y; }
  if (node.type === 'TEXT') { out.text = node.characters.slice(0,1000); out.textTruncated = node.characters.length > 1000; out.fontSize = node.fontSize === figma.mixed ? 'mixed' : node.fontSize; out.fontName = node.fontName === figma.mixed ? 'mixed' : node.fontName;out.textAlign=node.textAlignHorizontal;out.lineHeight=node.lineHeight===figma.mixed?'mixed':node.lineHeight; }
  if ('layoutMode' in node) { out.layout = node.layoutMode; out.gap = node.itemSpacing; out.padding = [node.paddingTop,node.paddingRight,node.paddingBottom,node.paddingLeft]; }
  if ('fills' in node && node.fills !== figma.mixed) out.fills = node.fills.filter(p => p.type === 'SOLID').map(p => ({ color: p.color, opacity: p.opacity === undefined ? 1 : p.opacity }));
  if('fills' in node && node.fills!==figma.mixed)out.images=node.fills.filter(p=>p.type==='IMAGE').map(p=>({imageHash:p.imageHash,scaleMode:p.scaleMode}));
  if ('layoutSizingHorizontal' in node) { out.sizingHorizontal = node.layoutSizingHorizontal; out.sizingVertical = node.layoutSizingVertical; }
  return out;
}
// Scoped extraction is additive: the existing read and mutation handlers remain intact.
function extractValue(value) {
  if (value === figma.mixed) return 'mixed';
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : String(value);
  if (Array.isArray(value)) return value.map(extractValue);
  if (value && typeof value === 'object') {
    const out = {}; for (const key of Object.keys(value)) { const item = extractValue(value[key]); if (item !== undefined) out[key] = item; } return out;
  }
  return value;
}
function extractProperties(node, keys) {
  const out = {};
  for (const key of keys) if (key in node) {
    try { const value = extractValue(node[key]); if (value !== undefined) out[key] = value; }
    catch (error) { (out.unavailable || (out.unavailable = [])).push({ property:key, reason:String(error.message).slice(0,160) }); }
  }
  return out;
}
function extractHash(value) {
  let hash = 2166136261; for (let i=0;i<value.length;i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash,16777619); } return (hash >>> 0).toString(16);
}
function extractBase(node, depth) {
  const out = {id:node.id,parentId:node.parent ? node.parent.id : null,name:node.name.slice(0,120),type:node.type,depth};
  Object.assign(out,extractProperties(node,['x','y','width','height','visible']));
  if ('children' in node) out.childCount = node.children.length;
  return out;
}
async function extractDetails(node, fields, depth) {
  const out = extractBase(node,depth);
  if (fields.includes('layout')) out.layout = extractProperties(node,[
    'absoluteBoundingBox','absoluteRenderBounds','relativeTransform','rotation','layoutMode','layoutWrap',
    'primaryAxisAlignItems','counterAxisAlignItems','counterAxisAlignContent','primaryAxisSizingMode','counterAxisSizingMode',
    'layoutSizingHorizontal','layoutSizingVertical','layoutAlign','layoutGrow','layoutPositioning',
    'itemSpacing','counterAxisSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'minWidth','maxWidth','minHeight','maxHeight','constraints','clipsContent','itemReverseZIndex','strokesIncludedInLayout']);
  if (fields.includes('appearance')) out.appearance = extractProperties(node,[
    'fills','strokes','effects','opacity','blendMode','isMask','maskType','strokeWeight','strokeAlign',
    'strokeCap','strokeJoin','dashPattern','strokeMiterLimit','strokeTopWeight','strokeRightWeight','strokeBottomWeight','strokeLeftWeight',
    'cornerRadius','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius','cornerSmoothing']);
  if (fields.includes('text') && node.type === 'TEXT') {
    out.text = {preview:node.characters.slice(0,240),length:node.characters.length,hasMore:node.characters.length>240,
      ...extractProperties(node,['fontName','fontSize','fontWeight','textAlignHorizontal','textAlignVertical',
        'textAutoResize','lineHeight','letterSpacing','paragraphSpacing','paragraphIndent','textCase','textDecoration','listSpacing'])};
    if (Object.values(out.text).includes('mixed')) out.text.styledRunsAvailable = true;
  }
  if (fields.includes('components') && ['INSTANCE','COMPONENT','COMPONENT_SET'].includes(node.type)) {
    out.components = extractProperties(node,['key','componentProperties','componentPropertyDefinitions','variantProperties','isExposedInstance']);
    if (node.type === 'INSTANCE') {
      try { const main = await node.getMainComponentAsync(); out.components.main = main ? {id:main.id,name:main.name.slice(0,120),key:main.key,remote:main.remote} : null; }
      catch(error) { out.components.mainUnavailable = String(error.message).slice(0,160); }
    }
    if (node.parent && node.parent.type === 'COMPONENT_SET') out.components.componentSet = {id:node.parent.id,name:node.parent.name.slice(0,120),key:node.parent.key};
  }
  if (fields.includes('variables')) out.variables = extractProperties(node,[
    'boundVariables','explicitVariableModes','resolvedVariableModes','fillStyleId','strokeStyleId','effectStyleId','textStyleId','gridStyleId']);
  if (fields.includes('css') && typeof node.getCSSAsync === 'function') {
    try { out.css = await node.getCSSAsync(); } catch(error) { out.css = {unavailable:String(error.message).slice(0,160)}; }
  }
  for (const key of ['layout','appearance','variables','components']) if (out[key] && !Object.keys(out[key]).length) delete out[key];
  return out;
}
function compactExtraction(result, compact) {
  if(!compact)return result;
  const out={...result,encoding:'shared-fields-v1',nodes:result.nodes.map(node=>{
    const record={...node};
    if(node.text){const {preview,length,hasMore,styledRunsAvailable,...style}=node.text;record.text={preview,length,hasMore,...(styledRunsAvailable?{styledRunsAvailable}:{}),style};}
    return record;
  })};
  const groups=['layout','appearance','components','variables','css'];const occurrences=new Map();
  function candidates(node){return [...groups.map(key=>({target:node,key})),...(node.text?[{target:node.text,key:'style'}]:[])];}
  for(const node of out.nodes)for(const {target,key}of candidates(node)) {
    if(!target[key])continue;const value=JSON.stringify(target[key]);const entry=occurrences.get(value)||{count:0,value:target[key]};entry.count++;occurrences.set(value,entry);
  }
  const sharedStyles={};let index=0;
  for(const [value,entry]of occurrences) {
    // Share only when it reduces actual JSON size, keeping tiny values inline.
    if(entry.count<2 || entry.count*value.length <= value.length+entry.count*20+25)continue;
    entry.ref=`s${++index}`;sharedStyles[entry.ref]=entry.value;
  }
  for(const node of out.nodes)for(const {target,key}of candidates(node)) {
    if(!target[key])continue;const entry=occurrences.get(JSON.stringify(target[key]));if(entry.ref)target[key]={$ref:entry.ref};
  }
  if(index)out.sharedStyles=sharedStyles;
  return out;
}
async function extractSection(args, detailed) {
  const root = args.nodeId ? await getNode(args.nodeId) : figma.currentPage;
  const depth = args.depth === undefined ? (detailed ? 2 : 1) : args.depth;
  const limit = args.limit || 40, maxChars = args.maxChars || (detailed ? 8000 : 4000);
  const fields = [...new Set(args.fields || ['layout','appearance','text','components','variables'])].sort();
  const signature = extractHash(JSON.stringify([root.id,figma.currentPage.id,depth,Boolean(args.includeHidden),detailed ? fields : [],args.compact!==false]));
  const entries = []; let skippedHidden = 0;
  function visit(node, level) {
    if (level && !args.includeHidden && node.visible === false) { skippedHidden++; return; }
    assert(entries.length < 10000,'Subtree exceeds the scan budget; choose a smaller section or depth');
    entries.push({node,level});
    if (level < depth && 'children' in node) for (const child of node.children) visit(child,level+1);
  }
  visit(root,0);
  const revision = extractHash(entries.map(({node})=>[node.id,node.parent && node.parent.id,node.name,node.visible,node.width,node.height].join('|')).join('\n'));
  let start = 0;
  if (args.cursor) {
    const cursor = JSON.parse(args.cursor);
    assert(cursor.signature === signature && cursor.revision === revision,'Outline changed or cursor options differ; restart this section read');
    assert(Number.isInteger(cursor.offset) && cursor.offset >= 0 && cursor.offset < entries.length,'Invalid section cursor'); start = cursor.offset;
  }
  const result = {ok:true,schemaVersion:1,pageId:figma.currentPage.id,rootId:root.id,nodes:[],returned:0,hasMore:false,nextCursor:null,skippedHidden};
  function continuation(offset) {
    result.returned = result.nodes.length; result.hasMore = offset < entries.length;
    result.nextCursor = result.hasMore ? JSON.stringify({signature,revision,offset}) : null;
  }
  let index = start;
  for (;index < entries.length && result.nodes.length < limit;index++) {
    const {node,level} = entries[index];
    let record = detailed ? await extractDetails(node,fields,level) : extractBase(node,level);
    if ('children' in node && node.children.length && level === depth) record.childrenOmitted = true;
    // A pathological individual field must not defeat the response cap or pagination.
    const groups = Object.keys(record).filter(key=>fields.includes(key)).sort((a,b)=>JSON.stringify(record[b]).length-JSON.stringify(record[a]).length);
    while (JSON.stringify(record).length > maxChars - 700 && groups.length) {
      const key = groups.shift(); delete record[key]; (record.omittedFields || (record.omittedFields=[])).push(key);
    }
    result.nodes.push(record); continuation(index+1);
    if (JSON.stringify(compactExtraction(result,detailed && args.compact!==false)).length > maxChars) { result.nodes.pop(); continuation(index); break; }
  }
  continuation(index);
  assert(result.nodes.length || start >= entries.length,'Response budget is too small for this node; increase maxChars');
  const packed=compactExtraction(result,detailed && args.compact!==false);
  assert(JSON.stringify(packed).length <= maxChars,'Extraction response exceeds the character budget');
  return packed;
}
async function extractText(args) {
  const node = await getNode(args.nodeId); assert(node.type === 'TEXT','Text extraction requires a TEXT node');
  const start = args.start || 0, maxChars = args.maxChars || 6000;
  assert(start <= node.characters.length,'Text start is past the end');
  let end = Math.min(node.characters.length,start+(args.length || 2000));
  const properties = ['fontName','fontSize','fontWeight','fills','textStyleId','fillStyleId','textCase','textDecoration','lineHeight','letterSpacing','paragraphSpacing','paragraphIndent','listOptions','listSpacing','indentation','hyperlink','boundVariables'];
  const result = {ok:true,nodeId:node.id,start,end,totalLength:node.characters.length,nextStart:null,text:''};
  while (true) {
    // Keep surrogate pairs together; offsets still use Figma/JavaScript UTF-16 indices.
    if (end > start && end < node.characters.length && /[\uD800-\uDBFF]/.test(node.characters[end-1])) end--;
    if(end===start && start<node.characters.length)end=Math.min(start+2,node.characters.length);
    result.end=end;result.text=node.characters.slice(start,end);result.nextStart=end<node.characters.length?end:null;
    if (args.styled && end>start) result.runs=node.getStyledTextSegments(properties,start,end).map(segment=>{const copy=extractValue(segment);delete copy.characters;return copy;});
    if (JSON.stringify(result).length <= maxChars) break;
    assert(end-start > 2,'One styled character exceeds the budget; increase maxChars or read unstyled'); end=start+Math.max(1,Math.floor((end-start)/2));
  }
  return result;
}
async function extractTokens(args) {
  const maxChars=args.maxChars || 6000, consumer=args.nodeId ? await getNode(args.nodeId) : null;
  const result={ok:true,variables:[],nextOffset:null}; let offset=args.offset || 0;
  assert(offset <= args.ids.length,'Token offset exceeds requested IDs');
  for(;offset<args.ids.length;offset++) {
    let record;
    try {
      const variable=await figma.variables.getVariableByIdAsync(args.ids[offset]); assert(variable,'Variable unavailable');
      record=extractProperties(variable,['id','name','resolvedType','variableCollectionId','valuesByMode','scopes','codeSyntax','description','remote']);
      const collection=await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
      if(collection) record.collection=extractProperties(collection,['id','name','defaultModeId','modes']);
      if(consumer) record.resolved=extractValue(variable.resolveForConsumer(consumer));
    } catch(error) { record={id:args.ids[offset],unavailable:String(error.message).slice(0,200)}; }
    if(JSON.stringify(record).length>maxChars-300) record={id:args.ids[offset],detailsOmitted:true,hint:'Increase maxChars to read this variable'};
    result.variables.push(record);result.nextOffset=offset+1<args.ids.length?offset+1:null;
    if(JSON.stringify(result).length>maxChars){result.variables.pop();break;}
  }
  result.nextOffset=offset<args.ids.length?offset:null;
  assert(result.variables.length || offset===args.ids.length,'Increase token response budget');return result;
}
const extractTransfers = new Map();
async function extractAsset(args, commandId) {
  const now=Date.now();for(const [key,entry] of extractTransfers) if(now-entry.at>120000)extractTransfers.delete(key);
  const node=await getNode(args.nodeId);let entry;
  if(args.transferId) {
    entry=extractTransfers.get(args.transferId);assert(entry && entry.nodeId===node.id && entry.pageId===figma.currentPage.id,'Asset transfer expired or target changed; restart export');
  } else {
    assert(!(args.offset>0),'Start an asset transfer at offset zero');
    let bytes,mimeType;const format=args.format || 'SVG';let imageHash=null;
    if(format==='ORIGINAL') {
      assert('fills' in node && node.fills!==figma.mixed,'Node has no readable image fills');
      const paint=args.paintIndex===undefined?node.fills.find(p=>p.type==='IMAGE'):node.fills[args.paintIndex];
      assert(paint && paint.type==='IMAGE' && paint.imageHash,'Select an IMAGE fill');imageHash=paint.imageHash;
      const image=figma.getImageByHash(imageHash);assert(image,'Image bytes unavailable');bytes=await image.getBytesAsync();
      const head=Array.from(bytes.slice(0,12));
      mimeType=head[0]===137 && head[1]===80?'image/png':head[0]===255 && head[1]===216?'image/jpeg':head[0]===71 && head[1]===73?'image/gif':head.slice(0,4).map(n=>String.fromCharCode(n)).join('')==='RIFF' && head.slice(8,12).map(n=>String.fromCharCode(n)).join('')==='WEBP'?'image/webp':'application/octet-stream';
    } else {
      assert(typeof node.exportAsync==='function','Node cannot be exported');
      bytes=await node.exportAsync(format==='SVG'?{format:'SVG'}:{format:'PNG',constraint:{type:'SCALE',value:args.scale || 1}});
      mimeType=format==='SVG'?'image/svg+xml':'image/png';
    }
    assert(bytes.length <= (args.maxBytes || 16777216),'Asset exceeds maxBytes; reduce PNG scale or raise maxBytes (maximum 32 MiB)');
    if(extractTransfers.size>=2)extractTransfers.delete(extractTransfers.keys().next().value);
    entry={nodeId:node.id,pageId:figma.currentPage.id,format,mimeType,imageHash,bytes,at:now,transferId:commandId};extractTransfers.set(commandId,entry);
  }
  const offset=args.offset || 0;assert(offset <= entry.bytes.length,'Asset offset is past the end');
  const end=Math.min(offset+524288,entry.bytes.length);entry.at=now;
  return {ok:true,nodeId:entry.nodeId,pageId:entry.pageId,format:entry.format,mimeType:entry.mimeType,imageHash:entry.imageHash,
    byteLength:entry.bytes.length,transferId:entry.transferId,offset,nextOffset:end<entry.bytes.length?end:null,data:figma.base64Encode(entry.bytes.slice(offset,end))};
}
async function execute(command) {
  assert(command.pageId === figma.currentPage.id, 'Current page changed since request. Read context and retry with a new requestId.');
  const args = command.args || {};
  if(command.name==='figma_outline')return extractSection(args,false);
  if(command.name==='figma_inspect')return extractSection(args,true);
  if(command.name==='figma_text')return extractText(args);
  if(command.name==='figma_tokens')return extractTokens(args);
  if(command.name==='figma_asset')return extractAsset(args,command.id);
  if (command.name === 'figma_context') {
    const root = args.nodeId ? await getNode(args.nodeId) : figma.currentPage;
    const limit = args.limit || 200, depth = args.depth === undefined ? 2 : args.depth;
    let count = 0, truncated = false;
    function walk(node, level) {
      if (count >= limit) { truncated = true; return null; } count++;
      const data = summary(node);
      if ('children' in node) {
        data.childCount = node.children.length;
        if (level < depth) { data.children = []; for (const child of node.children) { const item = walk(child, level + 1); if (item) data.children.push(item); else break; } }
        else if (node.children.length) { data.childrenOmitted = true; truncated = true; }
      }
      return data;
    }
    return { ok: true, pageId: figma.currentPage.id, selection: figma.currentPage.selection.map(n => n.id), tree: walk(root,0), nodeCount: count, truncated };
  }
  if (command.name === 'figma_find') {
    const matches = [], stack = figma.currentPage.children.slice().reverse(), limit = args.limit || 50;
    let visited = 0, truncated = false;
    while (stack.length) {
      if (++visited > 20000) { truncated = true; break; }
      const node = stack.pop();
      if ((!args.query || node.name.toLowerCase().includes(args.query.toLowerCase())) && (!args.type || node.type === args.type)) {
        if (matches.length === limit) { truncated = true; break; } matches.push(summary(node));
      }
      if ('children' in node) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    return { ok: true, matches, visited, truncated };
  }
  if (command.name === 'figma_library') {
    const limit = args.limit || 100, query = (args.query || '').toLowerCase();
    const fonts = (await figma.listAvailableFontsAsync()).map(f => f.fontName).filter(f => (f.family + ' ' + f.style).toLowerCase().includes(query));
    const variables = (await figma.variables.getLocalVariablesAsync()).filter(v => v.name.toLowerCase().includes(query));
    const styles = (await figma.getLocalTextStylesAsync()).filter(s => s.name.toLowerCase().includes(query));
    return { ok: true, fonts: fonts.slice(0,limit), variables: variables.slice(0,limit).map(v => ({ id: v.id, name: v.name, type: v.resolvedType, collectionId: v.variableCollectionId, valuesByMode: v.valuesByMode })), textStyles: styles.slice(0,limit).map(s => ({ id: s.id, name: s.name, fontName: s.fontName, fontSize: s.fontSize })), counts: { fonts: fonts.length, variables: variables.length, textStyles: styles.length }, truncated: fonts.length > limit || variables.length > limit || styles.length > limit };
  }
  if (command.name === 'figma_create') {
    await preflight(args.scene);
    const parent = args.parentId ? await getNode(args.parentId) : figma.currentPage;
    assert(parent.type === 'PAGE' || parent.type === 'FRAME', 'Parent must be PAGE or FRAME');
    const created = [];
    try {
      const node = await createNode(args.scene, parent, created);
      if (parent.type === 'PAGE') { node.x = args.scene.x === undefined ? Math.max(0, ...parent.children.filter(n => n.id !== node.id).map(n => n.x + n.width)) + 80 : args.scene.x; node.y = args.scene.y || 0; }
      figma.currentPage.selection = [node]; figma.viewport.scrollAndZoomIntoView([node]); figma.commitUndo();
      return { ok: true, rootId: node.id, createdNodeIds: created, root: summary(node) };
    } catch (error) {
      const removed = [], cleanupFailed = [];
      for (const id of created.slice().reverse()) { try { const node = await figma.getNodeByIdAsync(id); if (node && !node.removed) { node.remove(); removed.push(id); } } catch (_) { cleanupFailed.push(id); } }
      return { ok: false, error: error.message, createdNodeIds: created, removedNodeIds: removed, cleanupFailedNodeIds: cleanupFailed, safeToRetry: cleanupFailed.length === 0, limitation: 'Library imports may remain in the file.' };
    }
  }
  if (command.name === 'figma_update') {
    const node = await getNode(args.nodeId);
    try { await applyProps(node, args.props); figma.commitUndo(); return { ok: true, mutatedNodeIds: [node.id], node: summary(node) }; }
    catch (error) { return { ok: false, error: error.message, mutatedNodeIds: [node.id], safeToRetry: false, recovery: 'Read this node before retrying; properties may be partly applied. Figma Undo is available.' }; }
  }
  if(command.name==='figma_replace_children') {
    const parent=await getNode(args.nodeId);
    assert(parent.type==='FRAME','Replacement requires an explicit FRAME');
    const counter={n:0};for(const scene of args.children)await preflight(scene,0,counter);
    const old=parent.children.slice(),created=[];
    try {
      for(const scene of args.children)await createNode(scene,parent,created);
    }catch(error){
      for(const id of created.slice().reverse()){const n=await figma.getNodeByIdAsync(id);if(n && !n.removed)n.remove();}
      return{ok:false,error:error.message,safeToRetry:true,preservedNodeIds:old.map(n=>n.id)};
    }
    const removed=[];
    try {for(const n of old){removed.push(n.id);n.remove();}figma.commitUndo();}
    catch(error){return{ok:false,error:error.message,safeToRetry:false,createdNodeIds:created,removedNodeIds:removed};}
    return{ok:true,rootId:parent.id,createdNodeIds:created,removedNodeIds:removed,root:summary(parent)};
  }
  if(command.name==='figma_patch') {
    const root=await getNode(args.rootId), resolved=[];
    for(const change of args.changes) {
      const node=await getNode(change.nodeId);let parent=node;
      while(parent && parent.id!==root.id)parent=parent.parent;
      assert(parent,'Patch node is outside the requested root');validateProps(node,change.props);resolved.push({node,props:change.props});
    }
    await loadFonts(root);
    const mutated=[];
    try {for(const {node,props}of resolved){mutated.push(node.id);await applyProps(node,props);}figma.commitUndo();return{ok:true,rootId:root.id,mutatedNodeIds:[...new Set(mutated)]};}
    catch(error){return{ok:false,error:error.message,rootId:root.id,mutatedNodeIds:[...new Set(mutated)],safeToRetry:false,recovery:'Inspect the touched nodes before retrying. Figma Undo is available.'};}
  }
  if (command.name === 'figma_export') {
    const node = await getNode(args.nodeId);
    const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: args.scale || 1 } });
    assert(bytes.length <= 4 * 1024 * 1024, 'PNG exceeds 4 MiB; use a smaller scale or node');
    return { ok: true, nodeId: node.id, image: figma.base64Encode(bytes), byteLength: bytes.length };
  }
  throw new Error('Unknown command');
}
figma.ui.onmessage = async message => {
  if (message.type === 'panel-size') {
    if (typeof message.compact === 'boolean') {
      const { width, height } = message.compact ? { width: 284, height: 50 } : expandedPanel;
      figma.ui.resize(width, height);
    }
    return;
  }
  if (message.type === 'settings-read') {
    try { figma.ui.postMessage({type:'settings',token:await figma.clientStorage.getAsync('local-bridge-token-v1'),pluginId:figma.pluginId}); }
    catch(error) { figma.ui.postMessage({type:'settings',error:error && error.message || 'Figma requires an assigned plugin ID for persistent storage.'}); }
    return;
  }
  if (message.type === 'settings-save') {
    try { assert(/^[0-9a-f]{64}$/.test(message.token),'Invalid saved pairing'); await figma.clientStorage.setAsync('local-bridge-token-v1',message.token); figma.ui.postMessage({type:'settings-saved',ok:true}); }
    catch(error) { figma.ui.postMessage({type:'settings-saved',ok:false,error:error && error.message || 'Assign the plugin ID once in Figma development settings.'}); }
    return;
  }
  if (message.type === 'settings-forget') { await figma.clientStorage.deleteAsync('local-bridge-token-v1'); return; }
  if (message.type === 'open-approval') {
    assert(/^http:\/\/localhost:43(?:1[89]|2[0-7])\/device\/approve\/[0-9a-f]{64}$/.test(message.url),'Invalid approval URL');
    figma.openExternal(message.url); return;
  }
  if (message.type === 'identity') return figma.ui.postMessage({ type: 'identity', fileName: figma.root.name, pageId: figma.currentPage.id, pageName: figma.currentPage.name });
  if (message.type !== 'command') return;
  const command = message.command;
  if (completed.has(command.id)) return figma.ui.postMessage({ type: 'result', id: command.id, result: completed.get(command.id) });
  if (busy) return figma.ui.postMessage({ type: 'result', id: command.id, result: { ok: false, error: 'Plugin busy', safeToRetry: true } });
  busy = true;
  let result;
  try { result = await execute(command); }
  catch (error) { result = { ok: false, error: error.message, safeToRetry: false }; }
  if(command.name !== 'figma_asset') completed.set(command.id, result); // Binary chunks must not accumulate in the result cache.
  if (completed.size > 1000) completed.delete(completed.keys().next().value);
  busy = false;
  figma.ui.postMessage({ type: 'result', id: command.id, result });
};
