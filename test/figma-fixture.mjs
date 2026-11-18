import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
export async function fixture({pluginPath}={}) {
  const nodes = new Map(), loaded = new Set(), messages = [];
  let index = 0;
  class Node {
    constructor(type, id = `1:${++index}`) {
      this.type = type; this.id = id; this.name = type; this.parent = null; this.removed = false;
      this.width = 100; this.height = 100; this.x = 0; this.y = 0; this.opacity = 1;
      this.fills = []; this.cornerRadius = 0; this.fontName = { family: 'Roboto', style: 'Regular' }; this.fontSize = 12; this._characters = '';
      this.paddingTop = this.paddingRight = this.paddingBottom = this.paddingLeft = 0;
      if (['FRAME','COMPONENT','PAGE'].includes(type)) { this.children = []; this.layoutMode = 'NONE'; this.itemSpacing = 0; }
      nodes.set(id,this);
    }
    get characters() { return this._characters; }
    set characters(value) { if (!loaded.has(JSON.stringify(this.fontName))) throw new Error('Font not loaded'); this._characters = value; }
    getStyledTextSegments() { return this._characters ? [{ fontName: this.fontName }] : []; }
    appendChild(child) { if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child); child.parent = this; this.children.push(child); }
    insertChild(index,child) {if(child.parent)child.parent.children=child.parent.children.filter(n=>n!==child);child.parent=this;this.children.splice(index,0,child);}
    resize(width,height) { this.width = width; this.height = height; this.layoutSizingHorizontal = this.layoutSizingVertical = 'FIXED'; }
    remove() { if (this.children) for (const child of [...this.children]) child.remove(); this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); nodes.delete(this.id); }
    createInstance() { return new Node('INSTANCE'); }
    async exportAsync() { return new Uint8Array([137,80,78,71]); }
  }
  const page = new Node('PAGE','0:1'); page.name = 'Designs'; page.selection = [];
  const figma = {
    currentPage: page, root: { name: 'Test document' }, mixed: Symbol('mixed'),
    showUI() {}, ui: { postMessage(message) { messages.push(message); } }, viewport: { scrollAndZoomIntoView() {} }, commitUndo() {},
    async getNodeByIdAsync(id) { return nodes.get(id) || null; },
    async loadFontAsync(font) { if (font.family === 'Missing') throw new Error('Font unavailable'); loaded.add(JSON.stringify(font)); },
    async listAvailableFontsAsync() { return [{ fontName: { family: 'Inter', style: 'Regular' } }]; },
    async getLocalTextStylesAsync() { return []; },
    variables: { async getLocalVariablesAsync() { return []; }, async getVariableByIdAsync(id) { return id === 'color:1' ? { id, resolvedType: 'COLOR' } : null; }, setBoundVariableForPaint(paint, property, variable) { return { ...paint, boundVariables: { [property]: { type: 'VARIABLE_ALIAS', id: variable.id } } }; } },
    base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); },
  };
  for (const type of ['Frame','Component','Text','Rectangle','Ellipse']) figma[`create${type}`] = () => { const node = new Node(type.toUpperCase()); page.appendChild(node); return node; };
  const source = await readFile(pluginPath || new URL('../plugin/code.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{ figma, __html__: '', console });
  async function execute(command) {
    await figma.ui.onmessage({ type: 'command', command });
    return JSON.parse(JSON.stringify(messages.findLast(m => m.type === 'result' && m.id === command.id).result));
  }
  return { figma, nodes, page, loaded, execute };
}
