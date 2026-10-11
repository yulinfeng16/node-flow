/*!
 * node-flow / ui.js
 * ---------------------------------------------------------------------------
 * Blender-style node editor UI on top of the core graph model. Pure DOM +
 * canvas, no framework, no build step, no external assets.
 *
 *   var ed = new NGEditor(hostElement, { registry: reg, graph: graph });
 *
 * Features: pan / zoom, box select, node drag + resize + collapse + mute,
 * socket-to-socket wire dragging, bezier wires with picking, link cutting,
 * context menus, fuzzy node search, multi-select, clipboard, undo/redo,
 * inline parameter widgets and live node previews.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var api = factory(
    (typeof module === 'object' && module.exports) ? require('./core.js') : (root && root.NG)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof define === 'function' && define.amd) define(['./core.js'], function (NG) { return factory(NG); });
  if (root) {
    root.NGEditor = api.Editor;
    root.NGEditorNS = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (NG) {
  'use strict';

  if (!NG) throw new Error('node-flow: ui.js requires core.js (window.NG) to be loaded first');

  var GRID = 16;

  /* =======================================================================
   * DOM helpers
   * ===================================================================== */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }
  function closestData(target, attr) {
    var e = target;
    while (e && e.getAttribute) {
      var v = e.getAttribute(attr);
      if (v !== null && v !== undefined && v !== '') return { value: v, element: e };
      e = e.parentNode;
    }
    return null;
  }
  function rgbToHex(c) {
    function h(v) { var s = Math.round(NG.clamp(v, 0, 1) * 255).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }
  function hexToRgb(hex) {
    var s = String(hex || '#000000').replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    if (!isFinite(n)) return { r: 0, g: 0, b: 0, a: 1 };
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  function lighten(hex, amount) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return hex;
    function h(v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + h(Math.min(255, Math.round(parseInt(m[1], 16) * amount))) +
      h(Math.min(255, Math.round(parseInt(m[2], 16) * amount))) +
      h(Math.min(255, Math.round(parseInt(m[3], 16) * amount)));
  }

  /* =======================================================================
   * Editor stylesheet (Blender-ish dark theme)
   * ===================================================================== */

  var STYLE_ID = 'node-flow-style';
  var EDITOR_CSS = [
    '.ng-root{position:absolute;inset:0;overflow:hidden;background:#1d1d1d;color:#e5e5e5;',
    'font:12px/1.4 "Segoe UI",Inter,Roboto,system-ui,sans-serif;user-select:none;-webkit-user-select:none;',
    'touch-action:none;outline:none;}',
    '.ng-root *{box-sizing:border-box;}',
    '.ng-grid,.ng-wires{position:absolute;left:0;top:0;display:block;pointer-events:none;}',
    '.ng-layer{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;}',
    '.ng-node{position:absolute;background:rgba(40,40,40,.95);border:1px solid #131313;border-radius:8px;',
    'box-shadow:0 6px 18px rgba(0,0,0,.45);display:flex;flex-direction:column;}',
    '.ng-node.selected{border-color:#ffb454;box-shadow:0 0 0 1px #ffb454,0 8px 22px rgba(0,0,0,.55);}',
    '.ng-node.muted{opacity:.5;}',
    '.ng-node.error{border-color:#e0574a;box-shadow:0 0 0 1px #e0574a,0 8px 22px rgba(0,0,0,.5);}',
    '.ng-node.running{border-color:#5fd0a0;}',
    '.ng-node.running .ng-head:after{content:"";position:absolute;left:0;bottom:-1px;height:2px;width:40%;',
    'background:#5fd0a0;animation:ngrun 1.1s linear infinite;}',
    '@keyframes ngrun{0%{left:0;opacity:.25}50%{opacity:1}100%{left:60%;opacity:.25}}',
    '.ng-head{position:relative;display:flex;align-items:center;gap:6px;padding:0 8px;height:26px;',
    'border-radius:7px 7px 0 0;cursor:move;overflow:hidden;flex:0 0 auto;}',
    '.ng-node.collapsed .ng-head{border-radius:7px;}',
    '.ng-dot{width:8px;height:8px;border-radius:3px;background:rgba(0,0,0,.45);flex:0 0 auto;}',
    '.ng-icon{flex:0 0 auto;font-size:11px;opacity:.9;}',
    '.ng-title{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;',
    'font-size:12px;text-shadow:0 1px 1px rgba(0,0,0,.5);}',
    '.ng-collapse{flex:0 0 auto;width:14px;height:14px;border:0;border-radius:4px;cursor:pointer;',
    'background:rgba(0,0,0,.25);color:#fff;font-size:9px;line-height:1;padding:0;}',
    '.ng-hint{position:absolute;right:8px;top:28px;background:#111;border:1px solid #333;color:#ddd;',
    'padding:2px 6px;border-radius:4px;font-size:11px;pointer-events:none;z-index:5;display:none;}',
    // No row-gap on the body: the port rows must sit at exactly ROW_H pitch so
    // a socket centred in its row is ROW_H away from the next one. Widget
    // fields carry their own vertical margin instead.
    // No overflow clipping here: the port rows deliberately stick out past the
    // node's edges (the dots are centred on the border) and clipping them would
    // cut the sockets in half - visually and for pointer hit-testing.
    '.ng-body{padding:6px 0 6px;display:flex;flex-direction:column;flex:1 1 auto;}',
    '.ng-node.collapsed .ng-body{display:none;}',
    // while a node is collapsed its rows are still built (hidden) so wire
    // endpoints can be measured from the real layout; see Editor#_measureLayout
    '.ng-node.collapsed.ng-collapsedrows .ng-body{display:flex;visibility:hidden;}',
    '.ng-node.ng-measuring *{transition:none!important;animation:none!important;}',
    // A port row is exactly ROW_H tall with no margin/gap, so the row pitch
    // equals the row box and a 13px socket fits without being clipped.
    // Editor#portAnchor documents and measures the same 24px.
    '.ng-row{position:relative;display:flex;align-items:center;height:24px;min-height:24px;',
    'padding:0 10px;flex:0 0 auto;margin:0;}',
    '.ng-row.out{justify-content:flex-end;}',
    '.ng-node.collapsed .ng-row{height:0;min-height:0;padding:0;overflow:hidden;}',
    '.ng-node.collapsed .ng-row .ng-label{display:none;}',
    '.ng-label{font-size:11.5px;color:#cfcfcf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    // --ng-sock      dot diameter (13px, 24px while a finger is in use)
    // --ng-sock-shift horizontal offset that keeps the dot's centre on the
    //                node border for any diameter, so wire endpoints measured
    //                while touch mode is active stay correct
    '.ng-root{--ng-sock:13px;--ng-sock-shift:calc(var(--ng-sock) / -2 - 1px);}',
    '.ng-sock{position:absolute;top:50%;width:var(--ng-sock,13px);height:var(--ng-sock,13px);',
    'margin-top:calc(var(--ng-sock,13px) / -2);border-radius:50%;',
    'border:1.5px solid #161616;box-shadow:0 0 0 1px rgba(0,0,0,.35);cursor:crosshair;z-index:3;}',
    '.ng-sock.in{left:var(--ng-sock-shift,-7.5px);}',
    '.ng-sock.out{right:var(--ng-sock-shift,-7.5px);}',
    '.ng-sock.multi{border-radius:4px;}',
    '.ng-sock:hover{transform:scale(1.3);}',
    '.ng-sock.linked{box-shadow:inset 0 0 0 2px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.35);}',
    '.ng-sock.target{outline:2px solid #fff;outline-offset:1px;}',
    '.ng-sock.bad{outline:2px dashed #e0574a;outline-offset:1px;}',
    // finger-sized controls, applied as soon as a touch pointer is seen
    '.ng-root.ng-touch{--ng-sock:24px;}',
    '.ng-root.ng-touch .ng-collapse{width:22px;height:22px;font-size:12px;}',
    '.ng-root.ng-touch .ng-head{height:32px;}',
    '.ng-root.ng-touch .ng-row{height:30px;min-height:30px;}',
    '.ng-root.ng-touch .ng-input{padding:6px 7px;font-size:13px;}',
    '.ng-field{display:flex;align-items:center;gap:6px;padding:0 8px;margin:3px 0;flex:0 0 auto;}',
    '.ng-field-label{flex:0 0 auto;font-size:11px;color:#a9a9a9;}',
    '.ng-input{flex:1 1 auto;min-width:0;background:#1b1b1b;border:1px solid #0e0e0e;border-radius:4px;',
    'color:#eee;font:11.5px/1.35 inherit;padding:3px 5px;outline:none;}',
    '.ng-input:focus{border-color:#ffb454;}',
    'input.ng-input[type=range]{padding:0;background:transparent;border:0;height:16px;}',
    'textarea.ng-input{font-family:"Cascadia Mono",Consolas,monospace;}',
    '.ng-select{cursor:pointer;}',
    '.ng-vec{display:flex;gap:4px;flex:1 1 auto;min-width:0;}',
    '.ng-badge{font-size:10.5px;padding:1px 6px;border-radius:8px;background:#2a2a2a;color:#bbb;flex:0 0 auto;}',
    '.ng-preview{padding:2px 8px 4px;flex:0 0 auto;}',
    '.ng-out{background:#171717;border:1px solid #2b2b2b;border-radius:5px;padding:4px 6px;',
    'font:11px/1.35 "Cascadia Mono",Consolas,monospace;color:#cfe8c8;white-space:pre-wrap;word-break:break-word;',
    'max-height:120px;overflow:auto;user-select:text;}',
    '.ng-note{padding:2px 8px;color:#9a9a9a;font-size:11px;flex:0 0 auto;}',
    '.ng-resize{position:absolute;right:1px;bottom:1px;width:14px;height:14px;cursor:nwse-resize;',
    'background:linear-gradient(135deg,transparent 45%,rgba(255,255,255,.28) 45%,rgba(255,255,255,.28) 55%,transparent 55%);}',
    '.ng-btn{border:1px solid #0e0e0e;border-radius:4px;background:#333;color:#eee;cursor:pointer;',
    'font:11.5px inherit;padding:3px 8px;}',
    '.ng-btn:hover{background:#3d3d3d;}',
    '.ng-btn:disabled{opacity:.45;cursor:default;}',
    '.ng-btn.wide{width:100%;}',
    '.ng-box{position:absolute;border:1px solid #ffb454;background:rgba(255,180,84,.13);pointer-events:none;z-index:6;}',
    '.ng-menu{position:fixed;min-width:180px;max-width:330px;background:#262626;border:1px solid #111;',
    'border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.6);padding:4px;z-index:60;overflow:auto;max-height:74vh;}',
    '.ng-menu-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;',
    'color:#e3e3e3;font:12px inherit;padding:5px 8px;border-radius:4px;cursor:pointer;}',
    '.ng-menu-item:hover,.ng-menu-item.active{background:#3f3f3f;}',
    '.ng-menu-item .ng-mi-cat{margin-left:auto;color:#8d8d8d;font-size:10.5px;}',
    '.ng-menu-sep{height:1px;background:#3a3a3a;margin:4px 2px;}',
    '.ng-menu-title{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#8d8d8d;padding:4px 8px;}',
    '.ng-empty{position:absolute;left:0;right:0;top:44%;text-align:center;color:#6d6d6d;',
    'font-size:13px;pointer-events:none;}'
  ].join('');

  function injectStyle() {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById(STYLE_ID)) return;
    var style = el('style');
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(EDITOR_CSS));
    document.head.appendChild(style);
  }

  /* =======================================================================
   * Widgets: parameter editors rendered inside a node body.
   * Every widget exposes read(widget) / write(widget, value) so the node
   * body stays the single source of truth.
   * ===================================================================== */

  var Widgets = { renderers: {}, readers: {}, writers: {} };

  function fieldInput(field, type) {
    var input = el('input', 'ng-input');
    input.type = type;
    input.spellcheck = false;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    if (field.step !== undefined) input.step = field.step;
    input.title = field.hint || field.label || field.key;
    return input;
  }

  Widgets.renderers.number = function (node, field) {
    var wrap = el('div', 'ng-field');
    if (field.label) wrap.appendChild(el('span', 'ng-field-label', field.label));
    var input = fieldInput(field, 'number');
    input.step = field.step === undefined ? 'any' : field.step;
    input.value = node.body[field.key] === undefined ? 0 : node.body[field.key];
    wrap.appendChild(input);
    if (field.unit) wrap.appendChild(el('span', 'ng-badge', field.unit));
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.number = function (w) { return NG.toNum(w.__value.value); };

  Widgets.renderers.int = function (node, field) {
    return Widgets.renderers.number(node, NG.assign({}, field, { step: field.step || 1 }));
  };
  Widgets.readers.int = function (w) { return Math.round(NG.toNum(w.__value.value)); };

  Widgets.renderers.range = function (node, field) {
    var wrap = el('div', 'ng-field');
    if (field.label) wrap.appendChild(el('span', 'ng-field-label', field.label));
    var input = fieldInput(field, 'range');
    input.min = field.min === undefined ? 0 : field.min;
    input.max = field.max === undefined ? 1 : field.max;
    input.step = field.step === undefined ? 0.01 : field.step;
    input.value = node.body[field.key] === undefined ? 0 : node.body[field.key];
    var readout = el('span', 'ng-badge', input.value);
    readout.style.minWidth = '36px';
    readout.style.textAlign = 'right';
    input.addEventListener('input', function () { readout.textContent = input.value; });
    wrap.appendChild(input);
    wrap.appendChild(readout);
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.range = function (w) { return NG.toNum(w.__value.value); };

  Widgets.renderers.text = function (node, field) {
    var wrap = el('div', 'ng-field');
    if (field.label && !field.inline) wrap.appendChild(el('span', 'ng-field-label', field.label));
    var input = fieldInput(field, 'text');
    input.value = node.body[field.key] === undefined ? '' : node.body[field.key];
    input.placeholder = field.placeholder || '';
    wrap.appendChild(input);
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.text = function (w) { return String(w.__value.value); };

  Widgets.renderers.textarea = function (node, field) {
    var wrap = el('div', 'ng-field');
    var input = el('textarea', 'ng-input');
    input.rows = field.rows || 4;
    input.style.resize = 'vertical';
    input.value = node.body[field.key] === undefined ? '' : node.body[field.key];
    input.placeholder = field.placeholder || '';
    wrap.appendChild(input);
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.textarea = function (w) { return String(w.__value.value); };

  Widgets.renderers.code = Widgets.renderers.textarea;
  Widgets.readers.code = Widgets.readers.textarea;

  Widgets.renderers.select = function (node, field) {
    var wrap = el('div', 'ng-field');
    if (field.label) wrap.appendChild(el('span', 'ng-field-label', field.label));
    var input = el('select', 'ng-input ng-select');
    var options = field.options || [];
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var value = NG.isObj(opt) ? opt.value : opt;
      var label = NG.isObj(opt) ? (opt.label === undefined ? opt.value : opt.label) : opt;
      var o = el('option', null, label);
      o.value = value;
      input.appendChild(o);
    }
    input.value = node.body[field.key] === undefined ? '' : node.body[field.key];
    wrap.appendChild(input);
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.select = function (w) { return String(w.__value.value); };

  Widgets.renderers.check = function (node, field) {
    var wrap = el('div', 'ng-field');
    var input = fieldInput(field, 'checkbox');
    input.checked = !!node.body[field.key];
    input.style.flex = '0 0 auto';
    input.style.width = '14px';
    input.style.height = '14px';
    input.style.accentColor = '#ffb454';
    wrap.appendChild(input);
    if (field.label) {
      var label = el('span', 'ng-field-label', field.label);
      label.style.cursor = 'pointer';
      label.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        input.checked = !input.checked;
        if (input.dispatchEvent) input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      wrap.appendChild(label);
    }
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.check = function (w) { return !!w.__value.checked; };

  Widgets.renderers.vector = function (node, field) {
    var wrap = el('div', 'ng-field');
    if (field.label) wrap.appendChild(el('span', 'ng-field-label', field.label));
    var box = el('div', 'ng-vec');
    var axes = field.axes || ['x', 'y', 'z'];
    var value = NG.toVec(node.body[field.key], axes.length);
    var inputs = {};
    for (var i = 0; i < axes.length; i++) {
      var input = fieldInput(field, 'number');
      input.step = field.step === undefined ? 'any' : field.step;
      input.value = value[axes[i]];
      input.title = axes[i].toUpperCase();
      inputs[axes[i]] = input;
      box.appendChild(input);
    }
    wrap.appendChild(box);
    wrap.__axes = axes;
    wrap.__inputs = inputs;
    return wrap;
  };
  Widgets.readers.vector = function (w) {
    var out = {};
    for (var i = 0; i < w.__axes.length; i++) out[w.__axes[i]] = NG.toNum(w.__inputs[w.__axes[i]].value);
    return out;
  };
  Widgets.writers = Widgets.writers || {};
  Widgets.writers.vector = function (w, value) {
    var v = NG.toVec(value, w.__axes.length);
    for (var i = 0; i < w.__axes.length; i++) w.__inputs[w.__axes[i]].value = v[w.__axes[i]];
  };

  Widgets.renderers.color = function (node, field) {
    var wrap = el('div', 'ng-field');
    if (field.label) wrap.appendChild(el('span', 'ng-field-label', field.label));
    var input = fieldInput(field, 'color');
    input.style.flex = '0 0 46px';
    input.style.height = '20px';
    input.style.padding = '0';
    input.value = rgbToHex(NG.toColor(node.body[field.key]));
    wrap.appendChild(input);
    wrap.__value = input;
    return wrap;
  };
  Widgets.readers.color = function (w) { return hexToRgb(w.__value.value); };

  Widgets.renderers.button = function (node, field, api) {
    var wrap = el('div', 'ng-field');
    var btn = el('button', 'ng-btn wide', field.label || field.key);
    if (NG.isFn(field.action)) {
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); field.action(node, api, ev); });
    }
    wrap.appendChild(btn);
    return wrap;
  };

  Widgets.renderers.note = function (node, field) {
    return el('div', 'ng-note', field.text || field.label || '');
  };

  /* =======================================================================
   * Editor
   * ===================================================================== */

  function Editor(host, options) {
    if (typeof host === 'string') host = document.querySelector(host);
    if (!host) throw new Error('NGEditor: host element not found');
    injectStyle();

    options = options || {};
    this.options = NG.defaults(options, {
      grid: GRID,
      snap: true,
      minZoom: 0.15,
      maxZoom: 2.5,
      nodeMinWidth: 120,
      wireWidth: 2.4,
      readOnly: false,
      globalKeys: false,
      showGrid: true,
      rightDragPan: true,
      dragNodeBody: true,
      /** touch: two fingers pinch to zoom, drag to pan (no wheel needed) */
      pinchZoom: true,
      /** touch: press and hold to open the context menu (no right button) */
      longPressMenu: true,
      longPressDelay: 500,
      longPressTolerance: 10
    });

    this.registry = options.registry || new NG.NodeRegistry();
    this.graph = options.graph || new NG.Graph({ registry: this.registry });
    if (!this.graph.registry) this.graph.registry = this.registry;
    this.history = options.history || new NG.History(this.graph, options.historyLimit || 150);

    this.selection = new Set();
    this.selectedEdges = new Set();

    this.zoom = 1;
    this.pan = { x: 40, y: 40 };
    this.pointerWorld = { x: 0, y: 0 };
    this._rendered = new Map();
    this._listeners = {};
    this._on = [];
    this._interaction = null;
    this._menu = null;
    this._search = null;
    this._boxEl = null;
    this._dpr = 1;
    this._size = { w: 800, h: 600 };
    this._rafPending = false;
    this._lastTarget = null;
    this._spaceDown = false;
    this._widgetSnap = null;
    /* touch: every pointer currently down, plus gesture/long-press state */
    this._pointers = new Map();
    this._longPress = null;
    this._longPressTolerance = 10;
    this._touchMode = false;
    this._wasGesture = false;
    this._gestureActive = false;

    this._buildDom(host);
    this._bindDomEvents();
    this._detectTouch();

    var self = this;
    this.graph.on('change', function () { self.invalidate(); });
    this.graph.on('history', function () { self.invalidate(); self.emit('history'); });

    this.resize();
    this.render();
  }

  Editor.prototype = {
    constructor: Editor,

    /* ---------------------------------------------------------------- DOM */

    _buildDom: function (host) {
      this.host = host;
      this.root = el('div', 'ng-root');
      this.root.tabIndex = 0;
      this.root.setAttribute('data-ng-root', '1');

      this.gridCanvas = el('canvas', 'ng-grid');
      this.wireCanvas = el('canvas', 'ng-wires');
      this.layer = el('div', 'ng-layer');
      this.emptyHint = el('div', 'ng-empty', 'Right-click or double-click to add a node \u2022 drag between sockets to wire');
      this.emptyHint.style.display = 'none';

      this.root.appendChild(this.gridCanvas);
      this.root.appendChild(this.wireCanvas);
      this.root.appendChild(this.layer);
      this.root.appendChild(this.emptyHint);
      host.appendChild(this.root);
      this.gridCtx = this.gridCanvas.getContext ? this.gridCanvas.getContext('2d') : null;
      this.wireCtx = this.wireCanvas.getContext ? this.wireCanvas.getContext('2d') : null;
    },

    _bindDomEvents: function () {
      var self = this, root = this.root;
      var listen = function (target, type, fn, opts) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, fn, opts);
        self._on.push([target, type, fn, opts]);
      };
      this._listen = listen;

      listen(root, 'pointerdown', function (ev) { self._onPointerDown(ev); });
      listen(root, 'pointermove', function (ev) { self._onPointerMove(ev); });
      listen(root, 'pointerup', function (ev) { self._onPointerUp(ev); });
      listen(root, 'pointercancel', function (ev) { self._disarmLongPress(); self._onPointerUp(ev); });
      listen(root, 'wheel', function (ev) { self._onWheel(ev); }, { passive: false });
      listen(root, 'dblclick', function (ev) { self._onDoubleClick(ev); });
      listen(root, 'contextmenu', function (ev) { self._onContextMenu(ev); });
      listen(root, 'keydown', function (ev) { self._onKeyDown(ev); });
      listen(root, 'keyup', function (ev) { self._onKeyUp(ev); });
      listen(root, 'pointerover', function (ev) { self._showHint(ev); });
      listen(root, 'focusout', function (ev) { self._onFocusOut(ev); });

      if (this.options.globalKeys) this.attachGlobalKeys();
      if (typeof window !== 'undefined') {
        this._windowListeners = [];
        var onResize = function () { self.resize(); };
        window.addEventListener('resize', onResize);
        this._windowListeners.push(['resize', onResize]);
      }
    },

    attachGlobalKeys: function () {
      if (this._globalKeys || typeof document === 'undefined') return;
      var self = this;
      var handler = function (ev) { self._onKeyDown(ev); };
      var up = function (ev) { self._onKeyUp(ev); };
      document.addEventListener('keydown', handler);
      document.addEventListener('keyup', up);
      this._on.push([document, 'keydown', handler], [document, 'keyup', up]);
      this._globalKeys = true;
    },

    destroy: function () {
      var i;
      for (i = 0; i < this._on.length; i++) {
        var rec = this._on[i];
        if (rec[0] && rec[0].removeEventListener) rec[0].removeEventListener(rec[1], rec[2], rec[3]);
      }
      this._on = [];
      var wl = this._windowListeners || [];
      for (i = 0; i < wl.length; i++) {
        if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener(wl[i][0], wl[i][1]);
      }
      this._windowListeners = [];
      this.closeMenu();
      this.closeSearch();
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.destroyed = true;
    },

    on: function (name, fn) {
      (this._listeners[name] = this._listeners[name] || []).push(fn);
      return this;
    },

    emit: function (name, payload) {
      var list = this._listeners[name];
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        try { list[i](payload, this); }
        catch (e) { if (typeof console !== 'undefined') console.error('[node-flow] listener error "' + name + '"', e); }
      }
    },

    /* --------------------------------------------------------- geometry */

    viewportRect: function () {
      var r = (this.root && this.root.getBoundingClientRect)
        ? this.root.getBoundingClientRect()
        : { left: 0, top: 0, width: 800, height: 600 };
      return { left: r.left || 0, top: r.top || 0, width: r.width || 800, height: r.height || 600 };
    },

    toWorld: function (clientX, clientY) {
      var r = this.viewportRect();
      return { x: (clientX - r.left - this.pan.x) / this.zoom, y: (clientY - r.top - this.pan.y) / this.zoom };
    },

    toScreen: function (x, y) {
      var r = this.viewportRect();
      return { x: r.left + this.pan.x + x * this.zoom, y: r.top + this.pan.y + y * this.zoom };
    },

    localToWorld: function (lx, ly) {
      return { x: (lx - this.pan.x) / this.zoom, y: (ly - this.pan.y) / this.zoom };
    },

    setView: function (pan, zoom) {
      if (pan) this.pan = { x: pan.x, y: pan.y };
      if (zoom) this.zoom = NG.clamp(zoom, this.options.minZoom, this.options.maxZoom);
      this.invalidate();
      this.emit('view');
    },

    nodeRect: function (node) {
      var rec = this._rendered.get(node.id);
      var h = node.h;
      if (!h) {
        if (rec && rec.root && rec.root.offsetHeight) h = rec.root.offsetHeight;
        else h = this.estimateHeight(node);
      }
      return { x: node.x, y: node.y, w: node.w, h: h };
    },

    estimateHeight: function (node) {
      if (node.collapsed) return 26;
      var rows = Math.max(node.inputs.length, node.outputs.length);
      var h = 26 + 10 + rows * 20 + 6 + 14;
      var body = (node.def && node.def.body) || [];
      for (var i = 0; i < body.length; i++) {
        var t = body[i].type || 'text';
        h += (t === 'textarea' || t === 'code') ? 74 : 24;
      }
      if (node.def && node.def.preview) h += 46;
      return h;
    },

    frameAll: function (padding) {
      padding = padding === undefined ? 60 : padding;
      var all = null, self = this;
      this.graph.nodes.forEach(function (n) { all = NG.Geo.unionRect(all, self.nodeRect(n)); });
      if (!all) return;
      var r = this.viewportRect();
      var z = NG.clamp(Math.min(
        (r.width - padding * 2) / Math.max(1, all.w),
        (r.height - padding * 2) / Math.max(1, all.h)
      ), this.options.minZoom, 1.4);
      this.setView({
        x: padding + Math.max(0, (r.width - padding * 2 - all.w * z) / 2) - all.x * z,
        y: padding + Math.max(0, (r.height - padding * 2 - all.h * z) / 2) - all.y * z
      }, z);
    },

    frameNode: function (node, padding) {
      padding = padding === undefined ? 80 : padding;
      var rect = this.nodeRect(node);
      var r = this.viewportRect();
      this.setView({
        x: r.width / 2 - (rect.x + rect.w / 2) * this.zoom,
        y: r.height / 2 - (rect.y + rect.h / 2) * this.zoom
      });
    },

    /**
     * Anchor of a socket in graph space, taken from the layout that was
     * measured while the node was last rendered (`rec.layout`).
     *
     * Measuring beats arithmetic here: the body padding, the row height, the
     * order of input/output rows and any host restyling all feed into the
     * result, and a collapsed node keeps its rows (hidden, zero height) so the
     * wires of a folded node still land on its edge instead of floating in the
     * middle of the canvas.
     */
    portAnchor: function (node, dir, socketId) {
      var list = dir === 'output' ? node.outputs : node.inputs;
      var index = 0;
      for (var i = 0; i < list.length; i++) if (list[i].id === socketId) { index = i; break; }
      var rec = this._rendered.get(node.id);
      var lay = rec && rec.layout;
      if (lay && lay.rows > 0) {
        // Input rows and output rows are two separate stacks: in N, out M ->
        // rows 0..N-1 then N..N+M-1. A shared grid would push every output
        // down by the number of inputs, which is the wire bug this fixes.
        var base = dir === 'input' ? lay.topIn : lay.topOut;
        var collapsed = !!node.collapsed;
        // when folded no row is drawn, so attach to the middle of the bar and
        // to its border instead of to the hidden socket position
        var y = collapsed ? node.y + lay.headerH / 2 : node.y + base + index * lay.rowH;
        var x = collapsed
          ? (dir === 'output' ? node.x + node.w + 1 : node.x - 1)
          : (dir === 'output' ? node.x + node.w + lay.socketOut : node.x - lay.socketIn);
        return { x: x, y: y };
      }
      // no layout measured yet (headless engine, or the node has not been
      // rendered): fall back to the documented layout constants, which match
      // the shipped stylesheet and the measured geometry above
      var HEAD = 26, PAD = 6, ROW = 24, SOCK_IN = 0.5, SOCK_OUT = 6.5;
      var baseY = HEAD + PAD + ROW / 2 + (dir === 'output' ? node.inputs.length * ROW : 0);
      return {
        x: dir === 'output' ? node.x + node.w + SOCK_OUT : node.x - SOCK_IN,
        y: node.collapsed ? node.y + HEAD / 2 : node.y + baseY + index * ROW
      };
    },

    /**
     * Measure a node's real layout (called once per DOM rebuild).
     *
     * Wire endpoints must match the rendered sockets exactly - the body
     * padding, row height, the input-before-output row order and any host
     * restyling all feed into that. So instead of hard-coding the geometry we
     * read it from the DOM (in graph units, i.e. divided by the view scale).
     *
     * A collapsed node hides its body, so the rows are measured with the
     * `ng-collapsedrows` class (body forced visible but transparent) and the
     * numbers are cached; folding a node therefore keeps its wires attached to
     * the node edge instead of letting them float off into the canvas.
     */
    _measureLayout: function (rec, node) {
      var first = null, outEntry = null, inEntry = null;
      rec.sockets.forEach(function (entry) {
        if (!first) first = entry;
        if (entry.dir === 'output' && !outEntry) outEntry = entry;
        if (entry.dir === 'input' && !inEntry) inEntry = entry;
      });
      if (!first) return;

      var collapsed = !!node.collapsed;
      if (collapsed) rec.root.classList.add('ng-collapsedrows');
      var view = this.viewportRect();
      var scale = this._effectiveScale(view);
      var nodeRect = rec.root.getBoundingClientRect();
      var rowRect = first.row.getBoundingClientRect();
      var sockProbe = first.element.getBoundingClientRect();
      // Engines without a layout pass (headless tests, some webviews) report
      // zero-sized boxes: keep the analytic fallback in portAnchor instead of
      // caching meaningless numbers.
      if (nodeRect.height <= 0 || rowRect.height <= 0 || sockProbe.width <= 0) {
        rec.layout = null;
        if (collapsed) rec.root.classList.remove('ng-collapsedrows');
        return;
      }
      var centreY = function (entry) {
        var r = entry.element.getBoundingClientRect();
        return (r.top + r.height / 2 - nodeRect.top) / scale;
      };

      var layout = {
        rows: rec.sockets.size,
        // the row box is the real pitch: a socket is centred inside its row
        rowH: (rowRect.height || 24) / scale,
        // centre of the first row of each stack, relative to the node's top
        topIn: inEntry ? centreY(inEntry) : 0,
        topOut: outEntry ? centreY(outEntry) : 0,
        headerH: (rec.head.getBoundingClientRect().height || 26) / scale,
        socketIn: collapsed ? 6.5 : (inEntry ? (inEntry.element.getBoundingClientRect().left +
          inEntry.element.getBoundingClientRect().width / 2 - nodeRect.left) / scale : 6.5),
        socketOut: collapsed ? 6.5 : 0
      };
      if (!collapsed && outEntry) {
        var outRect = outEntry.element.getBoundingClientRect();
        layout.socketOut = (outRect.left + outRect.width / 2 - nodeRect.right) / scale;
      }
      rec.layout = layout;

      if (collapsed) rec.root.classList.remove('ng-collapsedrows');
    },

    /** Scale factor actually applied to the node layer (transform or zoom). */
    _effectiveScale: function (view) {
      if (this._lastScale && this._lastScale.zoom === this.zoom && this._lastScale.w === view.width) {
        return this._lastScale.value;
      }
      var rect = this.layer.getBoundingClientRect ? this.layer.getBoundingClientRect() : null;
      var value = this.zoom;
      if (rect && view.width > 0 && rect.width > 0) value = rect.width / view.width;
      if (!isFinite(value) || value <= 0) value = this.zoom;
      this._lastScale = { zoom: this.zoom, w: view.width, value: value };
      return value;
    },

    /* ------------------------------------------------------------ render */

    invalidate: function () {
      var self = this;
      if (this._rafPending) return;
      this._rafPending = true;
      var run = function () { self._rafPending = false; self.render(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    },

    resize: function () {
      if (!this.root || !this.root.getBoundingClientRect) return;
      var r = this.root.getBoundingClientRect();
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      var canvases = [this.gridCanvas, this.wireCanvas];
      for (var i = 0; i < canvases.length; i++) {
        var c = canvases[i];
        if (!c) continue;
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      }
      this._dpr = dpr;
      this._size = { w: w, h: h };
      this.invalidate();
    },

    render: function () {
      if (this.destroyed) return;
      this._applyView();
      this.renderNodes();
      this.renderWires();
    },

    _applyView: function () {
      this.layer.style.transform = 'translate(' + this.pan.x + 'px,' + this.pan.y + 'px) scale(' + this.zoom + ')';
      this.emptyHint.style.display = this.graph.nodes.size === 0 ? 'block' : 'none';
    },

    renderNodes: function () {
      var self = this, alive = new Set();
      this.graph.nodes.forEach(function (node) {
        alive.add(node.id);
        self.renderNode(node);
      });
      this._rendered.forEach(function (rec, id) {
        if (alive.has(id)) return;
        if (rec.root && rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
        self._rendered.delete(id);
      });
    },

    /** Cheap signature of everything that requires a DOM rebuild. */
    _structureKey: function (node) {
      var key = [node.type, node.collapsed ? 1 : 0, node.w];
      var i;
      for (i = 0; i < node.inputs.length; i++) key.push(node.inputs[i].id, node.inputs[i].name, node.inputs[i].type, node.inputs[i].multi ? 1 : 0);
      for (i = 0; i < node.outputs.length; i++) key.push(node.outputs[i].id, node.outputs[i].name, node.outputs[i].type);
      var body = (node.def && node.def.body) || [];
      for (i = 0; i < body.length; i++) key.push(body[i].key);
      if (node.def && node.def.preview) key.push('preview');
      return key.join('|');
    },

    /**
     * Ask the node definition to rebuild its ports (dynamic sockets). Guarded
     * so a misbehaving definition can never turn rendering into an endless
     * port-churn loop.
     */
    _syncDynamicPorts: function (node) {
      var def = node.def;
      if (!def || typeof def.computePorts !== 'function') return;
      if (!node.__dynHash) node.__dynHash = {};
      var sig;
      try {
        sig = JSON.stringify(node.body) + '|' + JSON.stringify(node.custom || {}) + '|' + node.inputs.length + '|' + node.outputs.length;
      } catch (e) { sig = String(node.body); }
      if (node.__dynHash.sig === sig && node.__dynHash.count > 12) return;
      if (node.__dynHash.sig === sig) node.__dynHash.count++;
      else node.__dynHash = { sig: sig, count: 1 };
      this.graph.applyDynamicPorts(node);
    },

    renderNode: function (node) {
      this._syncDynamicPorts(node);
      var rec = this._rendered.get(node.id);
      if (!rec) {
        rec = { root: el('div', 'ng-node'), sockets: new Map(), widgets: {}, key: '', title: null };
        rec.root.setAttribute('data-ng-node', node.id);
        rec.head = el('div', 'ng-head');
        rec.head.setAttribute('data-ng-head', '1');
        rec.dot = el('span', 'ng-dot');
        rec.icon = el('span', 'ng-icon');
        rec.title = el('span', 'ng-title');
        rec.collapseBtn = el('button', 'ng-collapse', '\u2013');
        rec.collapseBtn.setAttribute('data-ng-collapse', '1');
        rec.collapseBtn.title = 'Collapse / expand';
        rec.head.appendChild(rec.dot);
        rec.head.appendChild(rec.icon);
        rec.head.appendChild(rec.title);
        rec.head.appendChild(rec.collapseBtn);
        rec.body = el('div', 'ng-body');
        rec.body.setAttribute('data-ng-body', '1');
        rec.hint = el('div', 'ng-hint');
        rec.root.appendChild(rec.head);
        rec.root.appendChild(rec.body);
        rec.root.appendChild(rec.hint);
        if (!this.options.readOnly) {
          rec.resizer = el('div', 'ng-resize');
          rec.resizer.setAttribute('data-ng-resize', '1');
          rec.root.appendChild(rec.resizer);
        }
        this.layer.appendChild(rec.root);
        this._rendered.set(node.id, rec);
        rec.key = '';
      }

      var def = node.def || {};
      var key = this._structureKey(node);
      if (key !== rec.key) {
        rec.key = key;
        rec.sockets = new Map();
        rec.widgets = {};
        rec.preview = null;
        rec.root.style.width = node.w + 'px';
        rec.head.style.background = 'linear-gradient(180deg,' + lighten(def.headerColor || def.color || '#4a4a4a', 1.25) +
          ',' + (def.headerColor || def.color || '#4a4a4a') + ')';
        rec.dot.style.background = def.dotColor || 'rgba(0,0,0,.4)';
        rec.icon.textContent = def.icon || '';
        rec.collapseBtn.textContent = node.collapsed ? '+' : '\u2013';
        rec.root.classList.toggle('collapsed', !!node.collapsed);
        clear(rec.body);
        // Ports are always built, even while collapsed: the rows stay in the
        // DOM (hidden, zero height) so wire endpoints can be measured from the
        // real layout and folding a node does not shift its wires.
        this._buildPortRows(rec, node, 'input');
        if (!node.collapsed) this._buildBody(rec, node);
        this._buildPortRows(rec, node, 'output');
        // measure while the body is still in its rendered state
        rec.root.classList.add('ng-measuring');
        this._measureLayout(rec, node);
        rec.root.classList.remove('ng-measuring');
      }
      this._syncNode(rec, node);
    },

    _buildPortRows: function (rec, node, dir) {
      var list = dir === 'output' ? node.outputs : node.inputs;
      for (var i = 0; i < list.length; i++) {
        var sock = list[i];
        var row = el('div', 'ng-row' + (dir === 'output' ? ' out' : ''));
        var dot = el('div', 'ng-sock ' + (dir === 'output' ? 'out' : 'in') + (sock.multi ? ' multi' : ''));
        dot.setAttribute('data-ng-sock', sock.id);
        dot.setAttribute('data-ng-dir', dir);
        dot.setAttribute('data-ng-node', node.id);
        dot.setAttribute('data-ng-row', String(i));
        dot.title = sock.name + ' (' + sock.type + ')';
        dot.style.backgroundColor = NG.colorOfType(sock.type);
        row.appendChild(dot);
        row.appendChild(el('div', 'ng-label', sock.name));
        rec.body.appendChild(row);
        rec.sockets.set(dir + ':' + sock.id, { element: dot, row: row, socket: sock, dir: dir, index: i });
      }
    },

    _buildBody: function (rec, node) {
      var self = this;
      var def = node.def || {};
      var api = {
        node: node,
        editor: this,
        graph: this.graph,
        refresh: function () { self.invalidate(); },
        commit: function (label) { self.graph.touch(); self.emit('node:change', node); }
      };

      if (NG.isFn(def.render)) {
        var custom = def.render(node, api);
        if (custom) {
          if (!custom.getAttribute || !custom.getAttribute('data-ng-widget')) custom.setAttribute('data-ng-widget', '1');
          rec.body.appendChild(custom);
        }
        return;
      }

      var fields = def.body || [];
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var type = field.type || 'text';
        if (type === 'note') { rec.body.appendChild(Widgets.renderers.note(node, field)); continue; }
        if (type === 'button') { rec.body.appendChild(Widgets.renderers.button(node, field, api)); continue; }
        var renderer = Widgets.renderers[type] || Widgets.renderers.text;
        var widget = renderer(node, field, api);
        if (!widget) continue;
        widget.setAttribute('data-ng-widget', field.key);
        widget.setAttribute('data-ng-field', field.key);
        rec.body.appendChild(widget);
        rec.widgets[field.key] = { field: field, widget: widget, type: type };
        this._wireFieldEvents(widget, node, field, type);
      }

      if (def.preview) {
        var prev = el('div', 'ng-preview');
        var out = el('div', 'ng-out', '');
        prev.appendChild(out);
        prev.setAttribute('data-ng-preview', '1');
        rec.body.appendChild(prev);
        rec.preview = out;
      }
    },

    /** Wire DOM events of one field to the node body + history. */
    _wireFieldEvents: function (widget, node, field, type) {
      var self = this;
      var isText = type === 'text' || type === 'textarea' || type === 'code' || type === 'number' || type === 'int' || type === 'vector' || type === 'color';
      var commit = function (label) {
        self._readField(node, field.key, type, widget);
        self.graph.touch();
        self._commitWidgetSnapshot(label);
        self.emit('node:change', node);
      };
      var preview = function () {
        self._readField(node, field.key, type, widget);
        self.graph.touch();
      };
      var begin = function () { self._beginWidgetSnapshot('edit ' + (field.label || field.key)); };

      widget.addEventListener('focusin', begin);
      widget.addEventListener('pointerdown', begin);
      widget.addEventListener('mousedown', begin);
      if (isText) {
        widget.addEventListener('input', preview);
        widget.addEventListener('change', function () { commit('edit ' + (field.label || field.key)); });
        widget.addEventListener('blur', function () { commit('edit ' + (field.label || field.key)); });
      } else {
        widget.addEventListener('change', function () { commit('set ' + (field.label || field.key)); });
      }
      // stop the canvas from hijacking widget interaction
      widget.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      widget.addEventListener('dblclick', function (ev) { ev.stopPropagation(); });
      widget.addEventListener('wheel', function (ev) { ev.stopPropagation(); });
      widget.addEventListener('click', function (ev) { ev.stopPropagation(); });
    },

    _readField: function (node, key, type, widget) {
      var reader = Widgets.readers[type];
      var value = reader ? reader(widget) : undefined;
      if (value !== undefined && node.body[key] !== value) node.body[key] = value;
      // dynamic ports may depend on widget values
      if (node.def && typeof node.def.computePorts === 'function') this.graph.applyDynamicPorts(node);
      var rec = this._rendered.get(node.id);
      if (rec && node.def && NG.isFn(node.def.onBodyChange)) node.def.onBodyChange(node, key, value, rec);
      return value;
    },

    _beginWidgetSnapshot: function (label) {
      if (this._widgetSnap) return;
      this._widgetSnap = { label: label, data: JSON.stringify(this.graph.serialize()), version: this.graph.version };
    },

    _commitWidgetSnapshot: function (label) {
      var snap = this._widgetSnap;
      this._widgetSnap = null;
      if (!snap) return;
      if (snap.version === this.graph.version) return;
      this.history.undoStack.push({ label: label || snap.label, data: snap.data, version: snap.version });
      if (this.history.undoStack.length > this.history.limit) this.history.undoStack.shift();
      this.history.redoStack.length = 0;
      this.graph.emit('history', this.history);
    },

    _onFocusOut: function (ev) {
      if (this._widgetSnap) {
        var snap = this._widgetSnap;
        this._widgetSnap = null;
        if (snap.version !== this.graph.version) {
          this.history.undoStack.push({ label: snap.label, data: snap.data, version: snap.version });
          if (this.history.undoStack.length > this.history.limit) this.history.undoStack.shift();
          this.history.redoStack.length = 0;
          this.graph.emit('history', this.history);
        }
      }
    },

    _syncNode: function (rec, node) {
      rec.root.style.left = node.x + 'px';
      rec.root.style.top = node.y + 'px';
      if (rec.root.style.height !== (node.h ? node.h + 'px' : '')) rec.root.style.height = node.h ? node.h + 'px' : '';
      var cls = rec.root.classList;
      cls.toggle('selected', this.selection.has(node.id));
      cls.toggle('muted', !!node.muted);
      var st = node.state || {};
      cls.toggle('error', !!st.error);
      cls.toggle('running', !!st.running);
      var title = this.options.titleFormatter ? this.options.titleFormatter(node) : node.title;
      if (rec.title.textContent !== title) rec.title.textContent = title;

      var linked = this._linkedSockets(node.id);
      rec.sockets.forEach(function (entry, key) {
        var el2 = entry.element;
        var isLinked = linked.has(key);
        if (!el2.classList) return;
        if (el2.classList.contains('linked') !== isLinked) el2.classList.toggle('linked', isLinked);
      });
      if (rec.preview) {
        var text = st.preview === undefined || st.preview === null ? '' : String(st.preview);
        if (rec.preview.textContent !== text) rec.preview.textContent = text;
      }
    },

    _linkedSockets: function (nodeId) {
      var set = new Set();
      this.graph.edges.forEach(function (e) {
        if (e.from === nodeId) set.add('output:' + e.fromSocket);
        if (e.to === nodeId) set.add('input:' + e.toSocket);
      });
      return set;
    },

    /** Push node.body values back into the widget DOM (undo / load / redo). */
    writeWidgets: function (node) {
      var rec = this._rendered.get(node.id);
      if (!rec) return;
      var keys = Object.keys(rec.widgets);
      for (var i = 0; i < keys.length; i++) {
        var entry = rec.widgets[keys[i]];
        var value = node.body[keys[i]];
        var writer = Widgets.writers[entry.type];
        if (writer) { writer(entry.widget, value); continue; }
        var dom = entry.widget.__value;
        if (!dom) continue;
        if (entry.type === 'check') dom.checked = !!value;
        else if (entry.type === 'color') dom.value = rgbToHex(NG.toColor(value));
        else if (value !== undefined && value !== null && String(dom.value) !== String(value)) dom.value = value;
      }
    },

    /* ------------------------------------------------------------- wires */

    _cubic: function (a, b) {
      var off = NG.clamp(Math.abs(b.x - a.x) * 0.55, 24, 200);
      return { p0: a, p1: { x: a.x + off, y: a.y }, p2: { x: b.x - off, y: b.y }, p3: b };
    },

    _edgePath: function (edge) {
      var from = this.graph.nodes.get(edge.from);
      var to = this.graph.nodes.get(edge.to);
      if (!from || !to) return null;
      return this._cubic(
        this.portAnchor(from, 'output', edge.fromSocket),
        this.portAnchor(to, 'input', edge.toSocket)
      );
    },

    renderWires: function () {
      var ctx = this.wireCtx;
      if (!ctx) return;
      var dpr = this._dpr, size = this._size;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size.w * dpr, size.h * dpr);
      ctx.scale(dpr, dpr);
      ctx.translate(this.pan.x, this.pan.y);
      ctx.scale(this.zoom, this.zoom);
      ctx.lineCap = 'round';

      var self = this;
      this.graph.edges.forEach(function (edge) {
        var path = self._edgePath(edge);
        if (!path) return;
        var selected = self.selectedEdges.has(edge.id);
        ctx.beginPath();
        ctx.moveTo(path.p0.x, path.p0.y);
        ctx.bezierCurveTo(path.p1.x, path.p1.y, path.p2.x, path.p2.y, path.p3.x, path.p3.y);
        ctx.strokeStyle = selected ? '#ffb454' : NG.colorOfType(edge.type);
        ctx.lineWidth = (selected ? self.options.wireWidth + 1.2 : self.options.wireWidth) / self.zoom;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.lineWidth = Math.max(0.3, self.options.wireWidth - 1.5) / self.zoom;
        ctx.stroke();
      });

      var inter = this._interaction;
      if (inter && inter.kind === 'wire' && inter.path) {
        var p = inter.path;
        ctx.beginPath();
        ctx.moveTo(p.p0.x, p.p0.y);
        ctx.bezierCurveTo(p.p1.x, p.p1.y, p.p2.x, p.p2.y, p.p3.x, p.p3.y);
        ctx.strokeStyle = NG.colorOfType(inter.origin.socket.type);
        ctx.lineWidth = this.options.wireWidth / this.zoom;
        ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      this.renderGrid();
    },

    renderGrid: function () {
      var ctx = this.gridCtx;
      if (!ctx) return;
      var dpr = this._dpr, size = this._size, r = this.viewportRect();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size.w * dpr, size.h * dpr);
      if (this.options.showGrid === false) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 1;

      var step = this.options.grid;
      while (step * this.zoom < 9) step *= 4;
      while (step * this.zoom > 90) step /= 4;
      var big = step * 4;
      var z = this.zoom;
      var left = -this.pan.x / z, top = -this.pan.y / z;
      var right = left + r.width / z, bottom = top + r.height / z;
      var x = Math.floor(left / step) * step;
      var y = Math.floor(top / step) * step;
      for (; x < right; x += step) {
        var sx = Math.round(this.pan.x + x * z) + 0.5;
        ctx.strokeStyle = (Math.abs(x / big - Math.round(x / big)) < 1e-6) ? 'rgba(255,255,255,.085)' : 'rgba(255,255,255,.032)';
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, r.height); ctx.stroke();
      }
      for (; y < bottom; y += step) {
        var sy = Math.round(this.pan.y + y * z) + 0.5;
        ctx.strokeStyle = (Math.abs(y / big - Math.round(y / big)) < 1e-6) ? 'rgba(255,255,255,.085)' : 'rgba(255,255,255,.032)';
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(r.width, sy); ctx.stroke();
      }
    },

    /* ------------------------------------------------------- interaction */

    _local: function (ev) {
      var r = this.viewportRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    },

    _hit: function (ev) {
      var target = ev.target;
      var sockRef = closestData(target, 'data-ng-sock');
      if (sockRef) {
        var nodeId = sockRef.element.getAttribute('data-ng-node');
        var node = this.graph.nodes.get(nodeId);
        var dir = sockRef.element.getAttribute('data-ng-dir');
        return {
          kind: 'sock', node: node, dir: dir, element: sockRef.element,
          socket: node ? NG.findSocket(node, dir, sockRef.value) : null
        };
      }
      if (closestData(target, 'data-ng-collapse')) {
        var c = closestData(target, 'data-ng-node');
        return { kind: 'collapse', node: this.graph.nodes.get(c.value) };
      }
      if (closestData(target, 'data-ng-resize')) {
        var rz = closestData(target, 'data-ng-node');
        return { kind: 'resize', node: this.graph.nodes.get(rz.value) };
      }
      if (closestData(target, 'data-ng-widget')) return { kind: 'widget' };
      // NOTE: tagName is upper-case in HTML but may be lower-case in XML/XHTML
      // documents, and a bare /A/ would accidentally match "SPAN" - so anchor
      // the pattern and compare case-insensitively.
      if (target && target.tagName && /^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION|A|LABEL)$/i.test(target.tagName)) {
        return { kind: 'widget' };
      }
      if (closestData(target, 'data-ng-head')) {
        var hRef = closestData(target, 'data-ng-node');
        return { kind: 'node', node: this.graph.nodes.get(hRef.value) };
      }
      var nodeRef = closestData(target, 'data-ng-node');
      if (nodeRef) {
        // the body is draggable too: grabbing empty space inside a node (its
        // labels, preview area, padding) moves it, exactly like the header.
        // Widgets were filtered out above, so sliders and text fields still work.
        var bodyRef = closestData(target, 'data-ng-body');
        var node = this.graph.nodes.get(nodeRef.value);
        return { kind: bodyRef ? 'nodebody' : 'node', node: node };
      }

      // No DOM ancestry to lean on (synthetic events such as the long-press
      // menu, programmatic drops, or a release without a preceding move): fall
      // back to geometry, so a synthetic hit over a node still reports a node.
      if (ev.clientX !== undefined && ev.clientY !== undefined) {
        var world = this.toWorld(ev.clientX, ev.clientY);
        var sock = this._findSocketAt(world.x, world.y, 20 / this.zoom);
        if (sock) return sock;
        var hitNode = this._findNodeAt(world.x, world.y);
        if (hitNode) return hitNode;
        return { kind: 'canvas', world: world };
      }
      return { kind: 'canvas' };
    },

    /** Topmost rendered node containing a graph-space point. */
    _findNodeAt: function (x, y) {
      var best = null;
      this._rendered.forEach(function (rec, nodeId) {
        var node = this.graph.nodes.get(nodeId);
        if (!node) return;
        // use the bounding rect, not offsetHeight: inside a transformed layer
        // the offset properties are not reliable
        var h = rec.root.getBoundingClientRect ? rec.root.getBoundingClientRect().height : 0;
        if (!h) h = this.estimateHeight(node);
        if (!h) return;
        if (x < node.x || x > node.x + node.w || y < node.y || y > node.y + h) return;
        if (!best || node.y > best.node.y) best = node;
      }, this);
      if (!best) return null;
      var headerH = (best.def && best.def.headerHeight) || 26;
      return { kind: (y - best.y) <= headerH ? 'node' : 'nodebody', node: best };
    },

    /** Nearest socket to a graph-space point, within `tolerance` units. */
    _findSocketAt: function (x, y, tolerance, onlyDir, excludeNodeId) {
      var best = null, bestDist = tolerance;
      var check = function (node, dir, socket, element) {
        if (onlyDir && dir !== onlyDir) return;
        if (excludeNodeId && node.id === excludeNodeId) return;
        var a = this.portAnchor(node, dir, socket.id);
        var dx = a.x - x, dy = a.y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d <= bestDist) { bestDist = d; best = { kind: 'sock', node: node, dir: dir, socket: socket, element: element }; }
      }.bind(this);
      this._rendered.forEach(function (rec, nodeId) {
        var node = this.graph.nodes.get(nodeId);
        if (!node) return;
        rec.sockets.forEach(function (entry) {
          check(node, entry.dir, entry.socket, entry.element);
        });
      }, this);
      return best;
    },

    /* ------------------------------------------------- touch & gestures */

    /** Track every pointer that is down (mouse, pen and finger alike). */
    _trackPointer: function (ev) {
      if (ev.pointerId === undefined) return null;
      var point = {
        id: ev.pointerId, type: ev.pointerType || 'mouse',
        x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY,
        target: ev.target || null
      };
      this._pointers.set(ev.pointerId, point);
      if (point.type === 'touch') this.markTouch();
      return point;
    },

    /** Forget a pointer and report whether a two-finger gesture remains. */
    _releasePointer: function (ev) {
      if (this._interaction && this._interaction.gesture) return true;
      var id = ev.pointerId;
      if (id === undefined) return false;
      this._pointers.delete(id);
      // only swallow the release while the *same* gesture is still alive: the
      // flag must not leak into later, unrelated pointers
      return !!this._gestureActive;
    },

    _touchPoints: function () {
      var out = [];
      this._pointers.forEach(function (p) { if (p.type === 'touch') out.push(p); });
      return out;
    },

    /** Switch the editor into finger-friendly sizing (larger sockets etc.). */
    markTouch: function () {
      if (this._touchMode) return;
      this._touchMode = true;
      if (this.root && this.root.classList) this.root.classList.add('ng-touch');
      // socket size and row height changed: re-measure and repaint
      this._rendered.forEach(function (rec) { rec.key = ''; });
      this.invalidate();
    },

    /** Called on construction: pre-enable touch sizing on touch-only devices. */
    _detectTouch: function () {
      if (typeof window === 'undefined') return;
      var coarse = false;
      try {
        coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      } catch (e) { /* matchMedia unavailable */ }
      if (coarse || (typeof window.ontouchstart !== 'undefined' && navigator && navigator.maxTouchPoints > 0)) {
        this.markTouch();
      }
    },

    /**
     * Two fingers: pinch to zoom and drag to pan. The view transform is driven
     * from the gesture's *anchor* (the graph point under the pinch centre), so
     * the content follows the fingers exactly and the anchor stays put under
     * them. Called on any pointer move or down while two pointers are present,
     * which also makes "second finger arrives mid-drag" safe.
     */
    _beginGesture: function () {
      if (this.options.pinchZoom === false) return false;
      var pts = this._touchPoints();
      if (pts.length < 2) return false;
      var a = pts[0], b = pts[1];
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var local = this._local({ clientX: mid.x, clientY: mid.y });
      this._cancelGesture();
      this._interaction = {
        kind: 'gesture',
        startDist: dist, startZoom: this.zoom, startMid: mid,
        anchor: { x: (local.x - this.pan.x) / this.zoom, y: (local.y - this.pan.y) / this.zoom }
      };
      this._wasGesture = true;
      this._gestureActive = true;
      this.emit('gesture');     // host may clear its own pending interaction
      return true;
    },

    _updateGesture: function () {
      var inter = this._interaction;
      if (!inter || inter.kind !== 'gesture') return false;
      var pts = this._touchPoints();
      if (pts.length < 2) return false;
      var a = pts[0], b = pts[1];
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var local = this._local({ clientX: mid.x, clientY: mid.y });
      var z = NG.clamp(inter.startZoom * (dist / inter.startDist), this.options.minZoom, this.options.maxZoom);
      this.zoom = z;
      this.pan.x = local.x - inter.anchor.x * z;
      this.pan.y = local.y - inter.anchor.y * z;
      this.invalidate();
      return true;
    },

    /**
     * Abandon an in-flight single-pointer interaction (a half-finished drag
     * must not be committed when a pinch starts).
     */
    _cancelGesture: function () {
      var inter = this._interaction;
      if (!inter || inter.kind === 'gesture') return false;
      if (inter.kind === 'move' && inter.nodes && inter.moved) {
        // put the dragged nodes back where the gesture found them
        for (var i = 0; i < inter.nodes.length; i++) {
          inter.nodes[i].node.x = inter.nodes[i].x;
          inter.nodes[i].node.y = inter.nodes[i].y;
        }
        this.graph.touch();
      }
      this.history.abort();
      this._interaction = null;
      this._hideBox();
      this._highlightTarget(null);
      var ids = [];
      this._pointers.forEach(function (p) { ids.push(p.id); });
      for (var k = 0; k < ids.length; k++) {
        try {
          if (this.root.releasePointerCapture) this.root.releasePointerCapture(ids[k]);
        } catch (e) { /* optional */ }
      }
      this.invalidate();
      return true;
    },

    /** Long press on a touch screen opens the context menu (there is no right
     *  button on a finger). Cancelled by movement or by lifting the finger. */
    _armLongPress: function (ev, point) {
      this._disarmLongPress();
      if (this.options.longPressMenu === false || this.options.readOnly) return;
      var self = this;
      var delay = this.options.longPressDelay || 500;
      var moveTolerance = this.options.longPressTolerance || 10;
      this._longPress = setTimeout(function () {
        self._longPress = null;
        var inter = self._interaction;
        if (!inter || inter.kind === 'gesture') return;
        if (inter.moved) return;                      // already a real drag
        if (inter.kind === 'move') {
          // a stationary finger on a node is a menu request, not a drag
          self._cancelGesture();
        } else if (inter.kind === 'wire' || inter.kind === 'resize') {
          self._cancelGesture();
        }
        self.openContextMenuAt({ clientX: point.x, clientY: point.y, target: point.target || null });
        self.emit('longpress');
      }, delay);
      this._longPressTolerance = moveTolerance;
    },

    _disarmLongPress: function () {
      if (this._longPress) {
        clearTimeout(this._longPress);
        this._longPress = null;
      }
    },

    _onPointerDown: function (ev) {
      var tracked = this._trackPointer(ev);
      if (tracked && tracked.type === 'touch' && ev.button === 0) {
        this._armLongPress(ev, { x: ev.clientX, y: ev.clientY });
      }
      if (this._beginGesture()) return;
      // a new sequence of pointers starts here
      this._gestureActive = false;
      if (ev.button === 2) {        // A right press is ambiguous: it should open the context menu when it
        // is a click, and pan the view when it is a drag. Decide on movement.
        // Over a node we keep the plain context-menu behaviour.
        var overNode = closestData(ev.target, 'data-ng-node');
        if (this.options.rightDragPan && !this.options.readOnly && !overNode) {
          // only a *moving* right press is a pan; make sure a stale suppression
          // flag can never swallow the menu of an independent right click
          this._rightCancelled = false;
          this._interaction = {
            kind: 'pan', start: { x: ev.clientX, y: ev.clientY },
            local: this._local(ev), pan: { x: this.pan.x, y: this.pan.y }, moved: false, right: true
          };
          this._capture(ev);
          return;
        }
        return;
      }
      this.cancelRightDrag(true);   // supersede any pending right-drag suppression
      if (ev.button !== 0 && ev.button !== 1) return;
      if (ev.button === 1) {
        // middle button always pans, wherever the cursor is
        if (!this.options.readOnly) {
          this._interaction = {
            kind: 'pan', start: { x: ev.clientX, y: ev.clientY },
            local: this._local(ev), pan: { x: this.pan.x, y: this.pan.y }, moved: false
          };
          this._capture(ev);
        }
        return;
      }
      if (this.root.focus) this.root.focus();
      var hit = this._hit(ev);
      var world = this.toWorld(ev.clientX, ev.clientY);
      var local = this._local(ev);

      if (hit.kind === 'widget') return;
      this.closeMenu();

      if (this.options.readOnly) {
        if (hit.kind === 'node' && hit.node) { this.clearSelection(); this.select(hit.node.id, true); }
        else if (hit.kind === 'canvas') { this.clearSelection(); this._syncSelectionClasses(); }
        return;
      }

      if (hit.kind === 'sock' && hit.node && hit.socket) { this._beginWire(ev, hit); return; }

      if (hit.kind === 'collapse' && hit.node) {
        this.history.begin('collapse');
        hit.node.collapsed = !hit.node.collapsed;
        this.graph.touch();
        this.history.commit();
        return;
      }
      if (hit.kind === 'resize' && hit.node) {
        this._interaction = { kind: 'resize', node: hit.node, start: world, rect: this.nodeRect(hit.node) };
        this.history.begin('resize node');
        this._capture(ev);
        return;
      }
      if ((hit.kind === 'node' || hit.kind === 'nodebody') && hit.node) {
        if (hit.kind === 'nodebody' && this.options.dragNodeBody === false) return;
        var additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
        if (!this.selection.has(hit.node.id)) {
          if (!additive) this.clearSelection();
          this.selection.add(hit.node.id);
        } else if (additive) {
          this.selection.delete(hit.node.id);
        }
        this._syncSelectionClasses();
        this.emit('selection');
        var nodes = [];
        for (var selIter = this.selection.values(), step = selIter.next(); !step.done; step = selIter.next()) {
          var n = this.graph.nodes.get(step.value);
          if (n && !n.locked) nodes.push({ node: n, x: n.x, y: n.y });
        }
        this._interaction = { kind: 'move', nodes: nodes, start: world, moved: false, altCopy: !!ev.altKey, copied: false };
        this.history.begin('move nodes');
        this._capture(ev);
        return;
      }

      var edge = this.pickEdge(ev.clientX, ev.clientY);
      if (edge) {
        if (ev.altKey) {
          this.history.begin('cut link');
          this.graph.disconnect(edge);
          this.history.commit();
          return;
        }
        if (!ev.shiftKey) { this.selection.clear(); this.selectedEdges.clear(); }
        this.selectedEdges.add(edge.id);
        this._syncSelectionClasses();
        this.emit('selection');
        return;
      }

      // empty canvas: Space+drag or Alt+drag pans, else box select
      if (this._spaceDown || ev.altKey) {
        this._interaction = {
          kind: 'pan', start: { x: ev.clientX, y: ev.clientY },
          local: local, pan: { x: this.pan.x, y: this.pan.y }, moved: false
        };
        this._capture(ev);
        return;
      }

      if (!ev.shiftKey) this.clearSelection();
      this._interaction = {
        kind: 'box', start: world, additive: !!ev.shiftKey,
        rect: { x: world.x, y: world.y, w: 0, h: 0 }
      };
      this._capture(ev);
      this.emit('selection');
    },

    _capture: function (ev) {
      try {
        if (this.root.setPointerCapture && ev.pointerId !== undefined) this.root.setPointerCapture(ev.pointerId);
      } catch (e) { /* optional */ }
    },

    _onPointerMove: function (ev) {
      var world = this.toWorld(ev.clientX, ev.clientY);
      this.pointerWorld = world;
      var tracked = this._pointers.get(ev.pointerId);
      if (tracked) {
        tracked.x = ev.clientX;
        tracked.y = ev.clientY;
        if (this._longPress) {
          var moved = Math.abs(ev.clientX - tracked.startX) + Math.abs(ev.clientY - tracked.startY);
          if (moved > (this._longPressTolerance || 10)) this._disarmLongPress();
        }
      }
      // a second finger takes over: pinch to zoom, drag to pan
      if (this.options.pinchZoom !== false && this._touchPoints().length >= 2) {
        if ((!this._interaction || this._interaction.kind !== 'gesture') && !this._beginGesture()) return;
        this._updateGesture();
        return;
      }
      var inter = this._interaction;
      if (!inter) return;
      var local = this._local(ev);

      if (inter.kind === 'pan') {
        var pdx = ev.clientX - inter.start.x, pdy = ev.clientY - inter.start.y;
        if (inter.right && !inter.moved && Math.abs(pdx) + Math.abs(pdy) < 3) return;  // still a click
        if (inter.right && !inter.moved) { inter.moved = true; this.cancelRightDrag(); }
        this.pan.x = inter.pan.x + pdx;
        this.pan.y = inter.pan.y + pdy;
        this.invalidate();
        return;
      }
      if (inter.kind === 'box') {
        inter.rect = {
          x: Math.min(world.x, inter.start.x), y: Math.min(world.y, inter.start.y),
          w: Math.abs(world.x - inter.start.x), h: Math.abs(world.y - inter.start.y)
        };
        var a = this.toScreen(inter.rect.x, inter.rect.y);
        this._showBox(a.x, a.y, inter.rect.w * this.zoom, inter.rect.h * this.zoom);
        this.selectInRect(inter.rect, inter.additive);
        return;
      }
      if (inter.kind === 'move') {
        var dx = world.x - inter.start.x, dy = world.y - inter.start.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) inter.moved = true;
        if (inter.altCopy && inter.moved && !inter.copied) {
          inter.copied = true;
          this.history.abort();
          var ids = [];
          this.selection.forEach(function (id) { ids.push(id); });
          var copy = this.graph.cloneNodes(ids, { x: 0, y: 0 });
          this.clearSelection();
          var self = this;
          copy.nodes.forEach(function (n) { self.selection.add(n.id); });
          this._syncSelectionClasses();
          inter.nodes = copy.nodes.map(function (n) { return { node: n, x: n.x, y: n.y }; });
          inter.start = world;
          dx = dy = 0;
          this.history.begin('copy nodes');
        }
        var snap = this.options.snap && !ev.ctrlKey;
        for (var i = 0; i < inter.nodes.length; i++) {
          var item = inter.nodes[i];
          var nx = item.x + dx, ny = item.y + dy;
          if (snap) {
            nx = Math.round(nx / this.options.grid) * this.options.grid;
            ny = Math.round(ny / this.options.grid) * this.options.grid;
          }
          item.node.x = nx;
          item.node.y = ny;
        }
        this.graph.touch();
        this.invalidate();
        return;
      }
      if (inter.kind === 'resize') {
        var w = Math.max(this.options.nodeMinWidth, inter.rect.w + (world.x - inter.start.x));
        var h = Math.max(40, inter.rect.h + (world.y - inter.start.y));
        if (this.options.snap && !ev.ctrlKey) {
          w = Math.round(w / this.options.grid) * this.options.grid;
          h = Math.round(h / this.options.grid) * this.options.grid;
        }
        inter.node.w = w;
        inter.node.h = h;
        this.graph.touch();
        this.invalidate();
        return;
      }
      if (inter.kind === 'wire') {
        var origin = inter.origin;
        var anchor = this.portAnchor(origin.node, origin.dir, origin.socket.id);
        var other = world;
        var target = null;
        var candidate = null;
        var targetHit = this._hit(ev);
        if (targetHit.kind === 'sock' && targetHit.node && targetHit.socket) candidate = targetHit;
        else {
          // no DOM socket under the pointer (synthetic events, or a release
          // without a preceding move): pick the nearest one geometrically
          var near = this._findSocketAt(world.x, world.y, 22 / this.zoom);
          var isSelf = near && near.node && near.socket &&
            near.node.id === origin.node.id && near.socket.id === origin.socket.id && near.dir === origin.dir;
          if (near && near.node && !isSelf) candidate = near;
        }
        var resolved = this._resolveWire(origin, candidate);
        if (resolved) {
          target = candidate;
          other = this.portAnchor(target.node, target.dir, target.socket.id);
        } else if (candidate && candidate.node) {
          this._markBadTarget(candidate);
        }
        inter.target = target;
        inter.path = origin.dir === 'output' ? this._cubic(anchor, other) : this._cubic(other, anchor);
        this._highlightTarget(target);
        this.invalidate();
        return;
      }
    },

    /** Flash a socket that cannot accept the dragged wire. */
    _markBadTarget: function (hit) {
      if (!hit || !hit.element || !hit.element.classList) return;
      hit.element.classList.add('bad');
      var el = hit.element;
      setTimeout(function () { el.classList.remove('bad'); }, 350);
    },

    _onPointerUp: function (ev) {
      this._disarmLongPress();
      var keepsGesture = this._releasePointer(ev);
      var inter = this._interaction;
      if (inter && inter.kind === 'gesture') {
        // lifting one finger of a pinch: stay in touch mode and let the
        // remaining finger start a fresh single-pointer interaction
        this._interaction = null;
        this._gestureActive = this._touchPoints().length >= 2;
        if (this._gestureActive) this._beginGesture();
        try {
          if (this.root.releasePointerCapture && ev.pointerId !== undefined) this.root.releasePointerCapture(ev.pointerId);
        } catch (e) { /* optional */ }
        this.emit('view');
        return;
      }
      if (keepsGesture) return;          // a non-gesture pointer ended mid-pinch
      if (!inter) return;
      this._interaction = null;
      this._hideBox();
      this._highlightTarget(null);
      try {
        if (this.root.releasePointerCapture && ev.pointerId !== undefined) this.root.releasePointerCapture(ev.pointerId);
      } catch (e) { /* optional */ }

      if (inter.kind === 'wire') {
        var hit = this._hit(ev);
        var originPt = inter.origin;
        var candidate = null;
        if (inter.target && inter.target.socket) candidate = inter.target;
        else if (hit.kind === 'sock' && hit.node && hit.socket) candidate = hit;
        else {
          var near = this._findSocketAt(this.toWorld(ev.clientX, ev.clientY).x,
            this.toWorld(ev.clientX, ev.clientY).y, 22 / this.zoom);
          var isSelf = near && near.node && near.socket &&
            near.node.id === originPt.node.id && near.socket.id === originPt.socket.id;
          if (near && near.node && !isSelf) candidate = near;
        }
        var resolved = this._resolveWire(originPt, candidate);
        if (resolved) {
          this.history.begin('connect sockets');
          this.graph.connect(resolved.out.node, resolved.out.socket, resolved.inp.node, resolved.inp.socket);
          this.history.commit();
        } else if (hit.kind === 'canvas') {
          // dropping on empty canvas offers the node search, pre-filtered
          if (inter.mode === 'move') this.history.commit();
          this.openSearch(ev.clientX, ev.clientY, { wire: inter });
        } else if (inter.mode === 'move') {
          // a detached wire dropped on nothing loses its old link
          this.history.commit();
        }
        this.invalidate();
        return;
      }
      if (inter.kind === 'move') {
        if (inter.moved) this.history.commit(); else this.history.abort();
        this.emit('nodes:moved', inter.nodes.map(function (i) { return i.node; }));
        this.invalidate();
        return;
      }
      if (inter.kind === 'resize') { this.history.commit(); this.emit('node:resized', inter.node); return; }
      if (inter.kind === 'box') { this.emit('selection'); return; }
      if (inter.kind === 'pan') {
        if (inter.right) {
          // a right press that never moved is a context-menu click
          if (!inter.moved) this.openContextMenuAt(ev);
          // the menu is open (or deliberately skipped): drop the guard until a
          // future right press arms it again
          this._rightCancelled = false;
        }
        this.emit('view');
      }
    },

    /** Open the context menu for a synthetic right-click (no DOM event). */
    openContextMenuAt: function (ev) {
      if (this.options.readOnly) return;
      var hit = this._hit(ev);
      if (hit.kind === 'node' || hit.kind === 'sock') this.openNodeMenu(ev.clientX, ev.clientY, hit.node);
      else this.openCanvasMenu(ev.clientX, ev.clientY);
    },

    /**
     * Swallow the context menu of an in-progress right-drag. `expireOnly`
     * clears a stale flag instead (used when a real interaction supersedes a
     * cancelled right drag).
     */
    cancelRightDrag: function (expireOnly) {
      if (expireOnly) { this._rightCancelled = false; return; }
      this._rightCancelled = true;
      var self = this;
      if (typeof setTimeout === 'function') setTimeout(function () { self._rightCancelled = false; }, 350);
    },

    /**
     * Start dragging a wire.
     *
     * The socket under the finger stays the *origin*; which side of the link it
     * ends up on is decided when the drag is released. That keeps both gestures
     * working regardless of how far apart the ports are - important on touch
     * screens, where a node's inputs and outputs are far enough apart that
     * guessing a "neighbouring output" is not reliable.
     */
    _beginWire: function (ev, hit) {
      var inter = {
        kind: 'wire', mode: 'new', target: null, path: null,
        origin: { node: hit.node, socket: hit.socket, dir: hit.dir }
      };
      // Grabbing an input that already carries a wire detaches that wire and
      // continues the drag from its source (a click that does not move simply
      // puts it back).
      if (hit.dir === 'input' && !hit.socket.multi) {
        var edges = this.graph.inEdges(hit.node.id, hit.socket.id);
        if (edges.length) {
          var edge = edges[0];
          var from = this.graph.nodes.get(edge.from);
          var fromSock = from ? NG.findSocket(from, 'output', edge.fromSocket) : null;
          if (from && fromSock) {
            inter.mode = 'move';
            inter.detached = edge;
            inter.origin = { node: from, socket: fromSock, dir: 'output' };
            this.history.begin('move link');
            this.graph.disconnect(edge);
          }
        }
      }
      if (inter.mode === 'new') this.history.begin('connect sockets');
      this._interaction = inter;
      this._capture(ev);
      this.invalidate();
    },

    /** Normalise a dragged pair into an output -> input link and verify it. */
    _resolveWire: function (origin, target) {
      if (!origin || !target || !origin.socket || !target.socket) return null;
      if (origin.node.id === target.node.id) return null;
      var out = origin.dir === 'output' ? origin : target;
      var inp = origin.dir === 'output' ? target : origin;
      if (out.dir !== 'output' || inp.dir !== 'input') return null;
      if (!NG.socketAccepts(inp.socket, out.socket.type)) return null;
      if (this.graph.wouldCycle(out.node.id, inp.node.id)) return null;
      return { out: out, inp: inp };
    },

    canConnect: function (a, b) {
      if (!a.socket || !b.socket) return false;
      if (a.node.id === b.node.id) return false;
      if (a.dir === b.dir) return false;
      var out = a.dir === 'output' ? a : b;
      var inp = a.dir === 'output' ? b : a;
      if (!NG.socketAccepts(inp.socket, out.socket.type)) return false;
      if (this.graph.wouldCycle(out.node.id, inp.node.id)) return false;
      return true;
    },

    _highlightTarget: function (target) {
      if (this._lastTarget && this._lastTarget.element && this._lastTarget.element.classList) {
        this._lastTarget.element.classList.remove('target');
      }
      if (target && target.element && target.element.classList) target.element.classList.add('target');
      this._lastTarget = target || null;
    },

    pickEdge: function (clientX, clientY) {
      var best = null, bestDist = 9, self = this;
      this.graph.edges.forEach(function (edge) {
        var path = self._edgePath(edge);
        if (!path) return;
        var p0 = self.toScreen(path.p0.x, path.p0.y);
        var p1 = self.toScreen(path.p1.x, path.p1.y);
        var p2 = self.toScreen(path.p2.x, path.p2.y);
        var p3 = self.toScreen(path.p3.x, path.p3.y);
        var d = NG.Geo.distToCubic(clientX, clientY, p0, p1, p2, p3, 26);
        if (d < bestDist) { bestDist = d; best = edge; }
      });
      return best;
    },

    /* --------------------------------------------------------- selection */

    select: function (id, add) {
      if (!add) this.clearSelection();
      this.selection.add(id);
      this._syncSelectionClasses();
      this.emit('selection');
    },

    deselect: function (id) {
      this.selection.delete(id);
      this._syncSelectionClasses();
      this.emit('selection');
    },

    clearSelection: function () {
      this.selection.clear();
      this.selectedEdges.clear();
      this._syncSelectionClasses();
    },

    selectAll: function () {
      var self = this;
      this.graph.nodes.forEach(function (n) { self.selection.add(n.id); });
      this._syncSelectionClasses();
      this.emit('selection');
    },

    selectInRect: function (rect, additive) {
      var self = this;
      if (!additive) this.selection.clear();
      this.graph.nodes.forEach(function (n) {
        if (NG.Geo.rectsOverlap(self.nodeRect(n), rect)) self.selection.add(n.id);
      });
      this._syncSelectionClasses();
    },

    getSelection: function () {
      var out = [], self = this;
      this.selection.forEach(function (id) {
        var n = self.graph.nodes.get(id);
        if (n) out.push(n);
      });
      return out;
    },

    _syncSelectionClasses: function () {
      var self = this;
      this._rendered.forEach(function (rec, id) {
        if (rec.root && rec.root.classList) rec.root.classList.toggle('selected', self.selection.has(id));
      });
      this.invalidate();
    },

    _showBox: function (x, y, w, h) {
      if (!this._boxEl) {
        this._boxEl = el('div', 'ng-box');
        this.root.appendChild(this._boxEl);
      }
      this._boxEl.style.display = 'block';
      this._boxEl.style.left = x + 'px';
      this._boxEl.style.top = y + 'px';
      this._boxEl.style.width = Math.max(0, w) + 'px';
      this._boxEl.style.height = Math.max(0, h) + 'px';
    },

    _hideBox: function () { if (this._boxEl) this._boxEl.style.display = 'none'; },

    /* -------------------------------------------------------------- zoom */

    _onWheel: function (ev) {
      if (ev.preventDefault) ev.preventDefault();
      var local = this._local(ev);
      var dy = ev.deltaY || 0;
      if (ev.deltaMode === 1) dy *= 16;
      var factor = Math.pow(0.999, dy);
      if (ev.ctrlKey) factor = Math.pow(0.9985, dy);
      this.zoomAt(local.x, local.y, factor);
    },

    zoomAt: function (lx, ly, factor) {
      var old = this.zoom;
      var z = NG.clamp(old * factor, this.options.minZoom, this.options.maxZoom);
      if (z === old) return;
      this.pan.x = lx - (lx - this.pan.x) * (z / old);
      this.pan.y = ly - (ly - this.pan.y) * (z / old);
      this.zoom = z;
      this.invalidate();
      this.emit('view');
    },

    zoomBy: function (factor) {
      var r = this.viewportRect();
      this.zoomAt(r.width / 2, r.height / 2, factor);
    },

    /* --------------------------------------------------------- shortcuts */

    _onKeyDown: function (ev) {
      var tag = ev.target && ev.target.tagName;
      var editing = tag && /INPUT|TEXTAREA|SELECT/.test(tag);
      var mod = ev.ctrlKey || ev.metaKey;

      if (ev.key === 'Escape') {
        this.closeMenu();
        this.closeSearch();
        if (this._interaction) {
          this.history.abort();
          this._interaction = null;
          this._hideBox();
        }
        this.clearSelection();
        this.invalidate();
        return;
      }
      if (editing) return;
      if (ev.code === 'Space') this._spaceDown = true;

      if (mod && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) this.history.redo(); else this.history.undo(); this.refresh(); return; }
      if (mod && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); this.history.redo(); this.refresh(); return; }
      if (mod && (ev.key === 'a' || ev.key === 'A')) { ev.preventDefault(); this.selectAll(); return; }
      if (mod && (ev.key === 'c' || ev.key === 'C')) { this.copy(); return; }
      if (mod && (ev.key === 'v' || ev.key === 'V')) { this.paste(); return; }
      if (mod && (ev.key === 'x' || ev.key === 'X')) { this.copy(); this.deleteSelection(); return; }
      if (mod && (ev.key === 'd' || ev.key === 'D')) { ev.preventDefault(); this.duplicate(); return; }

      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.deleteSelection(); return; }
      if (ev.key === 'h' || ev.key === 'H') { this.frameAll(); return; }
      if (ev.key === 'm' || ev.key === 'M') { this.toggleMute(); return; }
      if (ev.key === 'f' || ev.key === 'F') { this.toggleCollapse(); return; }
      if (ev.key === 'n' || ev.key === 'N') { this.emit('request:toggle-panel'); return; }
      if (ev.key === 'Tab') { ev.preventDefault(); this.emit('request:search'); return; }
    },

    _onKeyUp: function (ev) { if (ev.code === 'Space') this._spaceDown = false; },

    /* --------------------------------------------------------- clipboard */

    copy: function () {
      var self = this;
      var ids = [];
      this.selection.forEach(function (id) { ids.push(id); });
      if (!ids.length) return null;
      var idMap = {};
      var clip = { nodes: [], edges: [] };
      ids.forEach(function (id) {
        var n = self.graph.nodes.get(id);
        if (!n) return;
        var rec = NG.serializeNode(n);
        idMap[id] = rec.id = NG.uid('n');
        clip.nodes.push(rec);
      });
      this.graph.edges.forEach(function (e) {
        if (idMap[e.from] && idMap[e.to]) {
          clip.edges.push({
            id: NG.uid('e'), from: idMap[e.from], fromSocket: e.fromSocket,
            to: idMap[e.to], toSocket: e.toSocket, type: e.type
          });
        }
      });
      this._clipboard = clip;
      this.emit('clipboard', clip);
      return clip;
    },

    paste: function (at) {
      if (!this._clipboard || !this._clipboard.nodes.length) return null;
      var world = at || this.pointerWorld;
      var i, minX = Infinity, minY = Infinity;
      for (i = 0; i < this._clipboard.nodes.length; i++) {
        minX = Math.min(minX, this._clipboard.nodes[i].x);
        minY = Math.min(minY, this._clipboard.nodes[i].y);
      }
      this.history.begin('paste');
      var nodes = [], edges = [], idMap = {};
      for (i = 0; i < this._clipboard.nodes.length; i++) {
        var rec = NG.clone(this._clipboard.nodes[i]);
        rec.id = NG.uid('n');
        idMap[this._clipboard.nodes[i].id] = rec.id;
        rec.x = world.x + (rec.x - minX);
        rec.y = world.y + (rec.y - minY);
        var def = this.registry.get(rec.type) || { type: rec.type, title: rec.title, category: 'unknown', inputs: [], outputs: [] };
        var node = NG.makeNode(def, rec);
        node.id = rec.id;
        this.graph.nodes.set(node.id, node);
        nodes.push(node);
      }
      for (i = 0; i < this._clipboard.edges.length; i++) {
        var e = this._clipboard.edges[i];
        var from = this.graph.nodes.get(idMap[e.from]);
        var to = this.graph.nodes.get(idMap[e.to]);
        var edge = this.graph.connect(from, NG.findSocket(from, 'output', e.fromSocket), to, NG.findSocket(to, 'input', e.toSocket));
        if (edge) edges.push(edge);
      }
      this.graph.touch();
      this.history.commit();
      this.clearSelection();
      var self = this;
      nodes.forEach(function (n) { self.selection.add(n.id); });
      this._syncSelectionClasses();
      this.emit('selection');
      return { nodes: nodes, edges: edges };
    },

    duplicate: function () {
      if (!this.selection.size) return null;
      var clip = this.copy();
      if (!clip) return null;
      return this.paste({ x: this.pointerWorld.x + 24, y: this.pointerWorld.y + 24 });
    },

    deleteSelection: function () {
      if (this.options.readOnly) return null;
      if (!this.selection.size && !this.selectedEdges.size) return null;
      this.history.begin('delete');
      var self = this, removed = [];
      this.selection.forEach(function (id) {
        var n = self.graph.nodes.get(id);
        if (n && n.locked) return;
        if (self.graph.removeNode(id)) removed.push(id);
      });
      this.selectedEdges.forEach(function (id) { self.graph.disconnect(id); });
      this.selection.clear();
      this.selectedEdges.clear();
      this.history.commit();
      this.invalidate();
      this.emit('selection');
      return removed;
    },

    toggleMute: function () {
      if (!this.selection.size) return;
      this.history.begin('mute');
      var self = this;
      this.selection.forEach(function (id) {
        var n = self.graph.nodes.get(id);
        if (n) n.muted = !n.muted;
      });
      this.graph.touch();
      this.history.commit();
    },

    toggleCollapse: function () {
      if (!this.selection.size) return;
      this.history.begin('collapse');
      var self = this;
      this.selection.forEach(function (id) {
        var n = self.graph.nodes.get(id);
        if (n) n.collapsed = !n.collapsed;
      });
      this.graph.touch();
      this.history.commit();
    },

    /* --------------------------------------------------------------- add */

    addNode: function (type, pos, opts) {
      var def = typeof type === 'string' ? this.registry.get(type) : type;
      if (!def) return null;
      opts = opts || {};
      var p = pos || this.pointerWorld;
      var node = this.graph.addNode(def, p.x, p.y);
      if (opts.select !== false) {
        this.clearSelection();
        this.selection.add(node.id);
        this._syncSelectionClasses();
        this.emit('selection');
      }
      this.invalidate();
      return node;
    },

    addNodeAtCenter: function (type) {
      var r = this.viewportRect();
      return this.addNode(type, this.localToWorld(r.width / 2, r.height / 2));
    },

    /* -------------------------------------------------------------- menu */

    closeMenu: function () {
      if (this._menu && this._menu.parentNode) this._menu.parentNode.removeChild(this._menu);
      this._menu = null;
    },

    _menuButton: function (parent, label, fn, opts) {
      var self = this;
      opts = opts || {};
      var btn = el('button', 'ng-menu-item');
      if (opts.icon) btn.appendChild(el('span', 'ng-icon', opts.icon));
      btn.appendChild(el('span', null, label));
      if (opts.hint) btn.appendChild(el('span', 'ng-mi-cat', opts.hint));
      if (typeof btn.addEventListener === 'function') {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          self.closeMenu();
          fn();
        });
      }
      if (opts.disabled) btn.disabled = true;
      parent.appendChild(btn);
      return btn;
    },

    openNodeMenu: function (clientX, clientY, node) {
      var self = this;
      this.closeMenu();
      var menu = el('div', 'ng-menu');
      if (node) {
        menu.appendChild(el('div', 'ng-menu-title', node.title));
        this._menuButton(menu, node.muted ? 'Enable node' : 'Mute node', function () {
          self.history.begin('mute'); node.muted = !node.muted; self.graph.touch(); self.history.commit();
        }, { icon: '\u25CB', hint: 'M' });
        this._menuButton(menu, node.collapsed ? 'Expand' : 'Collapse', function () {
          self.history.begin('collapse'); node.collapsed = !node.collapsed; self.graph.touch(); self.history.commit();
        }, { icon: '\u25A2', hint: 'F' });
        this._menuButton(menu, 'Duplicate', function () {
          self.clearSelection(); self.selection.add(node.id); self._syncSelectionClasses(); self.duplicate();
        }, { icon: '\u29C9', hint: 'Ctrl+D' });
        this._menuButton(menu, 'Delete', function () {
          self.clearSelection(); self.selection.add(node.id); self._syncSelectionClasses(); self.deleteSelection();
        }, { icon: '\u2715', hint: 'Del' });
        menu.appendChild(el('div', 'ng-menu-sep'));
      }
      var extras = NG.isFn(this.options.buildContextMenu) ? this.options.buildContextMenu(node, this) : null;
      if (extras && extras.length) {
        for (var i = 0; i < extras.length; i++) {
          var item = extras[i];
          if (item.separator) { menu.appendChild(el('div', 'ng-menu-sep')); continue; }
          this._menuButton(menu, item.label, (function (it) {
            return function () { it.action(self); };
          })(item), { icon: item.icon, hint: item.hint, disabled: item.disabled });
        }
        menu.appendChild(el('div', 'ng-menu-sep'));
      }
      this._menuButton(menu, 'Add node\u2026', function () {
        self.openSearch(clientX, clientY);
      }, { icon: '\uFF0B', hint: 'Tab' });
      this._menuButton(menu, 'Frame all', function () { self.frameAll(); }, { icon: '\u2317', hint: 'H' });
      this._placeMenu(menu, clientX, clientY);
      return menu;
    },

    _placeMenu: function (menu, clientX, clientY) {
      this.closeMenu();
      menu.style.left = Math.max(4, clientX) + 'px';
      menu.style.top = Math.max(4, clientY) + 'px';
      if (typeof document !== 'undefined' && document.body) document.body.appendChild(menu);
      this._menu = menu;
      if (menu.getBoundingClientRect && typeof window !== 'undefined') {
        var r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth - 4) menu.style.left = Math.max(4, clientX - r.width) + 'px';
        if (r.bottom > window.innerHeight - 4) menu.style.top = Math.max(4, clientY - r.height) + 'px';
      }
    },

    openCanvasMenu: function (clientX, clientY) {
      var self = this;
      var world = this.toWorld(clientX, clientY);
      var menu = el('div', 'ng-menu');
      var groups = this.registry.byCategory();
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i];
        menu.appendChild(el('div', 'ng-menu-title', group.category));
        for (var j = 0; j < group.nodes.length; j++) {
          this._menuButton(menu, group.nodes[j].title, (function (def) {
            return function () {
              self.history.begin('add node');
              self.addNode(def.type, world);
              self.history.commit();
            };
          })(group.nodes[j]), { icon: group.nodes[j].icon || '\u25AA' });
        }
        menu.appendChild(el('div', 'ng-menu-sep'));
      }
      this._menuButton(menu, 'Search\u2026', function () { self.openSearch(clientX, clientY); }, { icon: '\u2315', hint: 'Tab' });
      this._menuButton(menu, 'Paste', function () { self.paste(world); }, { icon: '\u29C9', hint: 'Ctrl+V' });
      this._menuButton(menu, 'Frame all', function () { self.frameAll(); }, { icon: '\u2317', hint: 'H' });
      this._menuButton(menu, 'Select all', function () { self.selectAll(); }, { icon: '\u25A3', hint: 'Ctrl+A' });
      this._placeMenu(menu, clientX, clientY);
      return menu;
    },

    /* ------------------------------------------------------------ search */

    closeSearch: function () {
      if (this._search && this._search.parentNode) this._search.parentNode.removeChild(this._search);
      this._search = null;
    },

    openSearch: function (clientX, clientY, opts) {
      var self = this;
      opts = opts || {};
      this.closeSearch();
      var panel = el('div', 'ng-menu');
      panel.style.padding = '4px';
      var input = el('input', 'ng-input');
      input.type = 'text';
      input.placeholder = opts.wire ? 'Add node and connect\u2026' : 'Search nodes\u2026';
      var list = el('div');
      list.style.maxHeight = '46vh';
      list.style.overflow = 'auto';
      list.style.marginTop = '4px';
      panel.appendChild(input);
      panel.appendChild(list);

      var world = this.toWorld(clientX, clientY);
      var flat = [];
      var groups = this.registry.byCategory();
      for (var i = 0; i < groups.length; i++) for (var j = 0; j < groups[i].nodes.length; j++) flat.push(groups[i].nodes[j]);

      var active = 0, results = [];

      /** the socket being dragged when the palette was opened (if any) */
      function dragged() {
        return opts.wire && opts.wire.origin ? opts.wire.origin : null;
      }

      function compatible(def) {
        var origin = dragged();
        if (!origin || !origin.socket) return true;
        var ports = origin.dir === 'output' ? (def.inputs || []) : (def.outputs || []);
        for (var k = 0; k < ports.length; k++) {
          var candidate = NG.makeSocket(ports[k]);
          var ok = origin.dir === 'output'
            ? NG.socketAccepts(candidate, origin.socket.type)
            : NG.socketAccepts(origin.socket, candidate.type);
          if (ok) return true;
        }
        return false;
      }

      function refresh() {
        var q = input.value;
        var base = q ? self.registry.search(q, 200) : flat;
        results = [];
        for (var k = 0; k < base.length; k++) if (compatible(base[k])) results.push(base[k]);
        clear(list);
        if (!results.length) { list.appendChild(el('div', 'ng-menu-title', 'no match')); return; }
        active = NG.clamp(active, 0, results.length - 1);
        for (var m = 0; m < results.length; m++) {
          var btn = el('button', 'ng-menu-item' + (m === active ? ' active' : ''));
          btn.appendChild(el('span', 'ng-icon', results[m].icon || '\u25AA'));
          btn.appendChild(el('span', null, results[m].title));
          btn.appendChild(el('span', 'ng-mi-cat', results[m].category));
          btn.setAttribute('data-ng-index', m);
          list.appendChild(btn);
        }
      }

      function highlight() {
        for (var k = 0; k < list.childNodes.length; k++) {
          var child = list.childNodes[k];
          if (child.classList) child.classList.toggle('active', Number(child.getAttribute('data-ng-index')) === active);
        }
      }

      function choose(def) {
        var origin = dragged();
        self.history.begin('add node');
        var node = self.addNode(def.type, world);
        if (node && origin && origin.socket) {
          if (origin.dir === 'output') {
            var inSock = self._firstCompatible(node.inputs, origin.socket.type);
            if (inSock) self.graph.connect(origin.node, origin.socket, node, inSock);
          } else {
            var outSock = self._firstCompatible(node.outputs, origin.socket.type);
            if (outSock) self.graph.connect(node, outSock, origin.node, origin.socket);
          }
        }
        self.history.commit();
        self.closeSearch();
        self.invalidate();
      }

      if (typeof list.addEventListener === 'function') {
        list.addEventListener('click', function (ev) {
          var ref = closestData(ev.target, 'data-ng-index');
          if (ref && results[Number(ref.value)]) choose(results[Number(ref.value)]);
        });
      }
      input.addEventListener('input', function () { active = 0; refresh(); });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(active + 1, results.length - 1); highlight(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); if (results[active]) choose(results[active]); }
        else if (ev.key === 'Escape') { ev.preventDefault(); self.closeSearch(); }
        if (ev.stopPropagation) ev.stopPropagation();
      });

      refresh();
      panel.style.left = Math.max(4, clientX) + 'px';
      panel.style.top = Math.max(4, clientY) + 'px';
      panel.style.minWidth = '250px';
      if (typeof document !== 'undefined' && document.body) document.body.appendChild(panel);
      this._search = panel;
      if (input.focus) input.focus();
      if (panel.getBoundingClientRect && typeof window !== 'undefined') {
        var r = panel.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 4) panel.style.top = Math.max(4, clientY - r.height) + 'px';
        if (r.right > window.innerWidth - 4) panel.style.left = Math.max(4, clientX - r.width) + 'px';
      }
      return panel;
    },

    _firstCompatible: function (ports, type) {
      for (var i = 0; i < ports.length; i++) if (NG.typesCompatible(type, ports[i].type)) return ports[i];
      return ports[0] || null;
    },

    /* -------------------------------------------------------- other input */

    _onContextMenu: function (ev) {
      if (ev.preventDefault) ev.preventDefault();
      this._disarmLongPress();
      if (this.options.readOnly) return;
      // a right press on empty canvas is handled by _onPointerUp so that it can
      // tell a click (menu) from a drag (pan); see _onPointerDown
      if (this._rightCancelled) return;
      if (this.options.rightDragPan && !closestData(ev.target, 'data-ng-node')) return;
      this.openContextMenuAt(ev);
    },

    _onDoubleClick: function (ev) {
      if (ev.preventDefault) ev.preventDefault();
      var hit = this._hit(ev);
      if (hit.kind === 'canvas') { this.openSearch(ev.clientX, ev.clientY); return; }
      if (hit.kind === 'node' && hit.node && !this.options.readOnly) {
        var edge = this.pickEdge(ev.clientX, ev.clientY);
        if (edge) { this.history.begin('cut link'); this.graph.disconnect(edge); this.history.commit(); return; }
        this.history.begin('collapse');
        hit.node.collapsed = !hit.node.collapsed;
        this.graph.touch();
        this.history.commit();
      }
    },

    _showHint: function (ev) {
      var sockRef = closestData(ev.target, 'data-ng-sock');
      if (!sockRef) return;
      var nodeId = sockRef.element.getAttribute('data-ng-node');
      var node = this.graph.nodes.get(nodeId);
      var rec = node && this._rendered.get(node.id);
      if (!rec || !rec.hint) return;
      var sock = NG.findSocket(node, sockRef.element.getAttribute('data-ng-dir'), sockRef.value);
      if (!sock) return;
      rec.hint.textContent = sock.name + ' \u2022 ' + sock.type;
      rec.hint.style.display = 'block';
    },

    /* --------------------------------------------------------------- misc */

    /** Re-sync everything after the graph was replaced (undo / load / redo). */
    refresh: function () {
      var self = this;
      this._rendered.forEach(function (rec) { rec.key = ''; });
      this.selection.forEach(function (id) { if (!self.graph.nodes.has(id)) self.selection.delete(id); });
      this.selectedEdges.forEach(function (id) { if (!self.graph.edges.has(id)) self.selectedEdges.delete(id); });
      this.invalidate();
      this.render();
      var self2 = this;
      this.graph.nodes.forEach(function (n) { self2.writeWidgets(n); });
      this.emit('refresh');
    },

    /** Serialize the current document, including the view transform. */
    serialize: function () {
      this.graph.view = { x: this.pan.x, y: this.pan.y, zoom: this.zoom };
      return this.graph.serialize();
    },

    /** Load a document and restore the view transform. */
    load: function (doc, opts) {
      var res = this.graph.load(doc, opts);
      var view = doc && doc.view;
      if (view) { this.pan = { x: view.x || 0, y: view.y || 0 }; this.zoom = view.zoom || 1; }
      this.clearSelection();
      this.refresh();
      return res;
    },

    toJSON: function (pretty) { return JSON.stringify(this.serialize(), null, pretty ? 2 : 0); },

    /** Mark a node as running / errored and repaint it (used by host apps). */
    setNodeState: function (node, state) {
      if (!node) return;
      if (!node.state) node.state = { error: null, running: false, preview: null };
      if (state) {
        if (state.running !== undefined) node.state.running = state.running;
        if (state.error !== undefined) node.state.error = state.error;
        if (state.preview !== undefined) node.state.preview = state.preview;
      }
      var rec = this._rendered.get(node.id);
      if (rec) this._syncNode(rec, node);
    },

    /** Update widget DOM from model without a full rebuild. */
    syncWidgets: function (node) { this.writeWidgets(node); }
  };

  Editor.Widgets = Widgets;
  Editor.injectStyle = injectStyle;
  Editor.CSS = EDITOR_CSS;
  Editor.el = el;

  return { Editor: Editor, Widgets: Widgets, el: el, injectStyle: injectStyle, CSS: EDITOR_CSS };
});
