/*!
 * node-flow / core.js
 * ---------------------------------------------------------------------------
 * Portable core for a Blender-style node graph ("no-code programming")
 * editor. Zero dependencies, no build step, works in browsers, in Node and
 * inside Electron/webview shells.
 *
 *   <script src="core.js"></script>        ->  window.NG
 *   const NG = require('./core.js')        ->  module.exports
 *
 * The core is UI-agnostic: it holds the document model (nodes, sockets, links)
 * plus pure helpers (ids, geometry, coercion, serialisation). The editor UI
 * lives in ui.js.
 *
 * There is deliberately NO built-in node library and NO execution engine:
 * every node type is described by the host application (see NodeRegistry) and
 * the graph itself is the deliverable - a JSON document of nodes, sockets and
 * links that the host reads and acts upon.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof define === 'function' && define.amd) define([], function () { return api; });
  if (root) root.NG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var DOC_FORMAT = 'node-flow/graph';
  var DOC_VERSION = 1;

  /* =======================================================================
   * 1. Small utilities
   * ===================================================================== */

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return v !== null && typeof v === 'object' && !isArr(v); }
  function isFn(v) { return typeof v === 'function'; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function uid(prefix) {
    uid._n = (uid._n || 0) + 1;
    return (prefix || 'id') + '_' + uid._n.toString(36) + '_' +
      ((Math.random() * 0x100000000) >>> 0).toString(36);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (isArr(v)) {
      var a = new Array(v.length);
      for (var i = 0; i < v.length; i++) a[i] = clone(v[i]);
      return a;
    }
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k]);
    return o;
  }

  /** Shallow version of Object.assign that also works on old engines. */
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function defaults(target, src) {
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      if (target[k] === undefined) target[k] = src[k];
    }
    return target;
  }

  function noop() {}

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }

  /** Point/rect helpers, all in graph space unless noted otherwise. */
  var Geo = {
    rectContains: function (r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; },
    rectsOverlap: function (a, b) {
      return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
    },
    unionRect: function (a, b) {
      if (!a) return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
      if (!b) return { x: a.x, y: a.y, w: a.w, h: a.h };
      var x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
      var x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    },
    expandRect: function (r, pad) {
      return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    },
    /** Distance from point to a cubic bezier, sampled. Used for wire picking. */
    distToCubic: function (px, py, p0, p1, p2, p3, samples) {
      var n = samples || 24, best = Infinity, i, t, u, mt, mt2, u2, x, y, dx, dy, d;
      for (i = 0; i <= n; i++) {
        t = i / n; mt = 1 - t; mt2 = mt * mt; u2 = t * t;
        x = mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * u2 * p2.x + u2 * t * p3.x;
        y = mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * u2 * p2.y + u2 * t * p3.y;
        dx = x - px; dy = y - py; d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    }
  };

  /* =======================================================================
   * 2. Socket types, colours and coercion
   * ===================================================================== */

  var TYPE_COLORS = {
    any: '#a6a6a6',
    exec: '#f2f2f2',
    number: '#a1d17b',
    int: '#a1d17b',
    bool: '#e8a0a0',
    string: '#7fc8e8',
    vector: '#8f7ce0',
    color: '#e8c46a',
    list: '#4fc4b8',
    object: '#d59d5f',
    geometry: '#5fd0a0'
  };

  function colorOfType(type) { return TYPE_COLORS[type] || '#9aa0a6'; }

  var COERCIBLE = {
    number: { number: 1, int: 1, bool: 1, string: 1 },
    int: { number: 1, int: 1, bool: 1, string: 1 },
    bool: { bool: 1, number: 1, int: 1, string: 1 },
    string: { string: 1, number: 1, int: 1, bool: 1 },
    vector: { vector: 1, list: 1 },
    color: { color: 1, vector: 1, string: 1 },
    list: { list: 1, any: 1 },
    object: {},
    geometry: {},
    any: null,   // 'any' accepts everything
    exec: { exec: 1 }
  };

  /**
   * Socket type table. Hosts may extend or replace it entirely:
   *   NG.SocketTypes.define('image', { color: '#c060d0', accepts: ['image', 'any'] });
   * `accepts` lists the source types a socket of this type may receive
   * (omit for "anything goes"); `coerce` maps a value into this type.
   */
  var SocketTypes = {
    defs: {},
    colors: TYPE_COLORS,
    define: function (name, spec) {
      spec = spec || {};
      this.defs[name] = {
        name: name,
        label: spec.label || name,
        color: spec.color || colorOfType(name),
        accepts: spec.accepts || null,
        coerce: spec.coerce || null
      };
      if (spec.color) TYPE_COLORS[name] = spec.color;
      return this.defs[name];
    },
    get: function (name) { return this.defs[name] || null; },
    color: function (name) { return (this.defs[name] && this.defs[name].color) || colorOfType(name); },
    list: function () {
      var self = this, out = [];
      var seen = {};
      for (var k in TYPE_COLORS) if (Object.prototype.hasOwnProperty.call(TYPE_COLORS, k)) { out.push(k); seen[k] = 1; }
      for (k in this.defs) if (!seen[k]) out.push(k);
      return out.map(function (n) { return self.get(n) || { name: n, label: n, color: colorOfType(n), accepts: null, coerce: null }; });
    }
  };

  /** Would a value of `from` type be legal on a `to` socket? */
  function typesCompatible(from, to) {
    from = from || 'any'; to = to || 'any';
    if (from === to) return true;
    if (from === 'any' || to === 'any') return true;
    var def = SocketTypes.get(to);
    if (def && def.accepts) return def.accepts.indexOf(from) >= 0;
    var map = COERCIBLE[to];
    if (map === null || map === undefined) return true;
    return !!map[from];
  }

  /** Type check that also honours a per-port `accept` list. */
  function socketAccepts(socket, fromType) {
    if (!socket) return false;
    if (socket.accept && socket.accept.length) return socket.accept.indexOf(fromType) >= 0 || fromType === 'any';
    return typesCompatible(fromType, socket.type);
  }

  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === null || v === undefined || v === '') return 0;
    var n = parseFloat(String(v).trim());
    return isFinite(n) ? n : 0;
  }

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return Math.abs(v) > 1e-12;
    if (v === null || v === undefined) return false;
    if (isArr(v)) return v.length > 0;
    var s = String(v).trim().toLowerCase();
    return !(s === '' || s === '0' || s === 'false' || s === 'off' || s === 'no' || s === 'null' || s === 'undefined');
  }

  function toStr(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (isArr(v)) {
      var out = [];
      for (var i = 0; i < v.length; i++) out.push(toStr(v[i]));
      return out.join(', ');
    }
    if (isObj(v)) {
      if (typeof v.x === 'number') {
        return v.w !== undefined
          ? v.x + ', ' + v.y + ', ' + v.z + ', ' + v.w
          : (v.z !== undefined ? v.x + ', ' + v.y + ', ' + v.z : v.x + ', ' + v.y);
      }
      if (v.r !== undefined) return 'rgba(' + Math.round(v.r * 255) + ',' + Math.round(v.g * 255) + ',' + Math.round(v.b * 255) + ',' + (v.a === undefined ? 1 : v.a) + ')';
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  function toVec(v, size) {
    size = size || 3;
    if (isNum(v)) return { x: v, y: v, z: v, w: v };
    if (isArr(v)) return { x: toNum(v[0]), y: toNum(v[1]), z: toNum(v[2]), w: v.length > 3 ? toNum(v[3]) : 1 };
    if (isObj(v)) {
      if (typeof v.x === 'number') {
        return { x: toNum(v.x), y: toNum(v.y), z: toNum(v.z), w: v.w === undefined ? 1 : toNum(v.w) };
      }
      if (typeof v.r === 'number') return { x: toNum(v.r), y: toNum(v.g), z: toNum(v.b), w: v.a === undefined ? 1 : toNum(v.a) };
    }
    var n = toNum(v);
    return { x: n, y: n, z: n, w: n };
  }

  function toColor(v) {
    if (isObj(v) && typeof v.r === 'number') {
      return {
        r: clamp(v.r > 1 ? v.r / 255 : v.r, 0, 1),
        g: clamp(v.g > 1 ? v.g / 255 : v.g, 0, 1),
        b: clamp(v.b > 1 ? v.b / 255 : v.b, 0, 1),
        a: v.a === undefined ? 1 : clamp(v.a, 0, 1)
      };
    }
    if (isArr(v)) return toColor({ r: toNum(v[0]), g: toNum(v[1]), b: toNum(v[2]), a: v.length > 3 ? toNum(v[3]) : 1 });
    if (typeof v === 'string' && v.charAt(0) === '#') {
      var s = v.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      var int = parseInt(s, 16);
      if (isFinite(int)) return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255, a: 1 };
    }
    var n = clamp(toNum(v), 0, 1);
    return { r: n, g: n, b: n, a: 1 };
  }

  function toList(v) {
    if (isArr(v)) return v;
    if (v === null || v === undefined) return [];
    if (isObj(v) && typeof v.x === 'number') return [v.x, v.y, v.z];
    return [v];
  }

  /** Universal runtime converter. Hosts can register type-specific ones. */
  function coerce(value, fromType, toType, ctx) {
    fromType = fromType || 'any'; toType = toType || 'any';
    if (value === undefined && fromType === toType) return value;
    if (toType === 'any' || toType === fromType) return value;
    var def = SocketTypes.get(toType);
    if (def && isFn(def.coerce)) return def.coerce(value, fromType);
    switch (toType) {
      case 'number': case 'int': {
        var n = toNum(value);
        return toType === 'int' ? Math.round(n) : n;
      }
      case 'bool': return toBool(value);
      case 'string': return toStr(value);
      case 'vector': return toVec(value);
      case 'color': return toColor(value);
      case 'list': return toList(value);
      case 'exec': return value;
      default: return value;
    }
  }

  /** Coerce but mark nodes with a soft warning when information was lost. */
  function coerceChecked(value, fromType, toType, warn) {
    var out = coerce(value, fromType, toType);
    if (warn && fromType !== toType && fromType !== 'any' && toType !== 'any' && !typesCompatible(fromType, toType)) {
      warn('implicit conversion ' + fromType + ' \u2192 ' + toType);
    }
    return out;
  }

  /* =======================================================================
   * 3. Document model
   * ===================================================================== */

  function makeSocket(spec) {
    spec = spec || {};
    if (spec instanceof Object && spec.id && spec.name !== undefined && spec.type !== undefined && spec.__socket === true) {
      return spec;                                  // already a socket instance
    }
    var sock = {
      id: spec.id || uid('s'),
      name: spec.name || 'value',
      type: spec.type || 'any',
      multi: !!spec.multi,
      default: spec.default,
      /** optional explicit list of accepted source types */
      accept: spec.accept || null,
      /** optional per-port converter: (value, sourceType) -> value */
      coerce: spec.coerce || null,
      hint: spec.hint || '',
      /** set on outputs: which widget drives it (see NodeLib) */
      widget: spec.widget || null,
      /** marks a real socket instance (as opposed to a spec literal) */
      __socket: true
    };
    if (spec.default === undefined) sock.default = defaultForType(sock.type);
    return sock;
  }

  function defaultForType(type) {
    switch (type) {
      case 'number': case 'int': return 0;
      case 'bool': return false;
      case 'string': return '';
      case 'vector': return { x: 0, y: 0, z: 0 };
      case 'color': return { r: 1, g: 1, b: 1, a: 1 };
      case 'list': return [];
      default: return null;
    }
  }

  function makeEdge(from, fromSock, to, toSock, extra) {
    return assign({
      id: uid('e'),
      from: from, fromSocket: fromSock.id,
      to: to, toSocket: toSock.id,
      type: fromSock.type
    }, extra || {});
  }

  /**
   * A node instance.
   * @param {object} def  node type definition (see NodeRegistry.register)
   * @param {object} [data] persisted fields (id/x/y/body/ports...)
   */
  function makeNode(def, data) {
    data = data || {};
    var inputs = [];
    var outputs = [];
    var i;
    if (data.inputs) { for (i = 0; i < data.inputs.length; i++) inputs.push(makeSocket(data.inputs[i])); }
    else if (def && def.inputs) { for (i = 0; i < def.inputs.length; i++) inputs.push(makeSocket(def.inputs[i])); }

    if (data.outputs) { for (i = 0; i < data.outputs.length; i++) outputs.push(makeSocket(data.outputs[i])); }
    else if (def && def.outputs) { for (i = 0; i < def.outputs.length; i++) outputs.push(makeSocket(def.outputs[i])); }

    var body = {};
    if (def && def.body) {
      for (i = 0; i < def.body.length; i++) {
        var field = def.body[i];
        body[field.key] = field.value === undefined ? defaultForType(field.type || 'string') : clone(field.value);
      }
    }
    if (data.body) assign(body, clone(data.body));

    var node = {
      id: data.id || uid('n'),
      type: data.type || (def && def.type) || 'unknown',
      title: data.title !== undefined ? data.title : ((def && def.title) || (def && def.type) || 'Node'),
      x: isNum(data.x) ? data.x : 0,
      y: isNum(data.y) ? data.y : 0,
      w: isNum(data.w) ? data.w : ((def && def.width) || 180),
      h: isNum(data.h) ? data.h : ((def && def.height) || 0),
      collapsed: !!data.collapsed,
      muted: !!data.muted,
      locked: !!data.locked,
      comment: data.comment || '',
      inputs: inputs,
      outputs: outputs,
      body: body,
      /** free-form slot for the host application; round-tripped as-is */
      custom: data.custom ? clone(data.custom) : {},
      def: def || null,
      /** transient UI state set by the host editor (error/running/preview) */
      state: { error: null, running: false, preview: null }
    };
    if (isFn(node.def && node.def.init)) node.def.init(node);
    return node;
  }

  function serializeNode(node) {
    return {
      id: node.id,
      type: node.type,
      title: node.title,
      x: Math.round(node.x * 1000) / 1000,
      y: Math.round(node.y * 1000) / 1000,
      w: Math.round(node.w),
      h: Math.round(node.h || 0),
      collapsed: !!node.collapsed,
      muted: !!node.muted,
      locked: !!node.locked,
      comment: node.comment || '',
      body: clone(node.body),
      custom: clone(node.custom || {}),
      inputs: node.inputs.map(function (s) {
        return { id: s.id, name: s.name, type: s.type, multi: !!s.multi, default: clone(s.default), hint: s.hint || '' };
      }),
      outputs: node.outputs.map(function (s) {
        return { id: s.id, name: s.name, type: s.type, multi: !!s.multi, hint: s.hint || '' };
      })
    };
  }

  function serializeEdge(edge) {
    return { id: edge.id, from: edge.from, fromSocket: edge.fromSocket, to: edge.to, toSocket: edge.toSocket, type: edge.type };
  }

  /* =======================================================================
   * 4. Graph: the document
   * ===================================================================== */  function Graph(options) {
    options = options || {};
    this.nodes = new Map();      // id -> node  (insertion ordered)
    this.edges = new Map();      // id -> edge
    this.meta = assign({ name: 'Untitled graph', description: '', created: null }, options.meta || {});
    this.version = 0;            // data version, bumped on every mutation
    this.registry = options.registry || null;
    this._listeners = {};
    this._byType = null;         // lazily built index type -> [node]
  }

  Graph.prototype.on = function (event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return this;
  };

  Graph.prototype.off = function (event, fn) {
    var list = this._listeners[event];
    if (!list) return this;
    if (!fn) { delete this._listeners[event]; return this; }
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    return this;
  };

  Graph.prototype.emit = function (event, a, b) {
    var list = this._listeners[event];
    if (!list || !list.length) return this;
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i].call(this, a, b); }
      catch (err) { if (typeof console !== 'undefined') console.error('[node-flow] listener error on "' + event + '"', err); }
    }
    return this;
  };

  Graph.prototype.touch = function () {
    this.version++;
    this._byType = null;
    this.emit('change', this);
    return this.version;
  };

  /* --- nodes ---------------------------------------------------------- */

  Graph.prototype.node = function (id) { return this.nodes.get(id) || null; };

  Graph.prototype.nodeList = function () {
    var out = [];
    this.nodes.forEach(function (n) { out.push(n); });
    return out;
  };

  Graph.prototype.nodesOfType = function (type) {
    if (!this._byType) {
      var idx = new Map();
      this.nodes.forEach(function (n) {
        var list = idx.get(n.type);
        if (!list) { list = []; idx.set(n.type, list); }
        list.push(n);
      });
      this._byType = idx;
    }
    return this._byType.get(type) || [];
  };

  Graph.prototype.addNode = function (defOrNode, x, y) {
    var node;
    if (defOrNode instanceof Object && defOrNode.id && defOrNode.inputs && defOrNode.outputs && defOrNode._rt) {
      node = defOrNode;                                  // already a node
    } else if (typeof defOrNode === 'string') {
      var def = this.registry ? this.registry.get(defOrNode) : null;
      if (!def) throw new Error('Unknown node type "' + defOrNode + '"');
      node = makeNode(def, { x: x || 0, y: y || 0 });
    } else {
      node = makeNode(defOrNode, { x: x || 0, y: y || 0 });
    }
    if (this.nodes.has(node.id)) node.id = uid('n');
    this.nodes.set(node.id, node);
    this.touch();
    this.emit('node:add', node);
    return node;
  };

  Graph.prototype.removeNode = function (idOrNode) {
    var node = typeof idOrNode === 'string' ? this.nodes.get(idOrNode) : idOrNode;
    if (!node) return false;
    this.removeEdgesOf(node.id);
    this.nodes.delete(node.id);
    this.touch();
    this.emit('node:remove', node);
    return true;
  };

  Graph.prototype.setNodePosition = function (idOrNode, x, y) {
    var node = typeof idOrNode === 'string' ? this.nodes.get(idOrNode) : idOrNode;
    if (!node) return;
    node.x = x; node.y = y;
    this.touch();
    this.emit('node:move', node);
  };

  /** Deep-copies a set of nodes (wires inside the set are preserved). */
  Graph.prototype.cloneNodes = function (ids, offset) {
    offset = offset || { x: 24, y: 24 };
    var self = this;
    var idSet = new Map();
    var made = [];
    ids.forEach(function (id) {
      var src = self.nodes.get(id);
      if (!src) return;
      var copy = makeNode(src.def, {
        type: src.type, title: src.title,
        x: src.x + offset.x, y: src.y + offset.y,
        w: src.w, h: src.h, collapsed: src.collapsed, muted: src.muted,
        body: clone(src.body)
      });
      // keep socket ids so internal links can be remapped deterministically
      for (var i = 0; i < copy.inputs.length && i < src.inputs.length; i++) copy.inputs[i].type = src.inputs[i].type;
      idSet.set(src.id, copy.id);
      self.nodes.set(copy.id, copy);
      made.push(copy);
    });
    var newEdges = [];
    this.edges.forEach(function (edge) {
      if (idSet.has(edge.from) && idSet.has(edge.to)) {
        var from = self.nodes.get(idSet.get(edge.from));
        var to = self.nodes.get(idSet.get(edge.to));
        var fromSock = findSocket(from, 'output', edge.fromSocket);
        var toSock = findSocket(to, 'input', sockIndexById(self.nodes.get(edge.from), 'output', edge.fromSocket));
        if (fromSock && toSock) {
          var e = self.connect(from, fromSock, to, toSock);
          if (e) newEdges.push(e);
        }
      }
    });
    this.touch();
    this.emit('nodes:clone', made);
    return { nodes: made, edges: newEdges };
  };

  /* --- sockets & sockets lookup --------------------------------------- */

  function findSocket(node, dir, id) {
    if (!node) return null;
    var list = dir === 'output' ? node.outputs : node.inputs;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function socketIndexById(node, dir, id) {
    if (!node) return -1;
    var list = dir === 'output' ? node.outputs : node.inputs;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  Graph.prototype.socket = function (nodeId, dir, socketId) {
    return findSocket(this.nodes.get(nodeId), dir, socketId);
  };

  Graph.prototype.inputSocket = function (nodeId, name) {
    var node = this.nodes.get(nodeId);
    if (!node) return null;
    for (var i = 0; i < node.inputs.length; i++) if (node.inputs[i].name === name) return node.inputs[i];
    return null;
  };

  Graph.prototype.outputSocket = function (nodeId, name) {
    var node = this.nodes.get(nodeId);
    if (!node) return null;
    for (var i = 0; i < node.outputs.length; i++) if (node.outputs[i].name === name) return node.outputs[i];
    return null;
  };

  /** Replace the port list of a node, keeping ids where the name matches. */
  Graph.prototype.setPorts = function (node, dir, specs) {
    var oldList = dir === 'output' ? node.outputs : node.inputs;
    var byName = {};
    for (var i = 0; i < oldList.length; i++) byName[oldList[i].name] = oldList[i];
    var next = [];
    var kept = {};
    for (i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var existing = byName[spec.name];
      if (existing && !kept[existing.id]) {
        existing.name = spec.name;
        existing.type = spec.type || existing.type;
        existing.multi = spec.multi === undefined ? existing.multi : !!spec.multi;
        existing.hint = spec.hint || existing.hint;
        if (spec.accept) existing.accept = spec.accept;
        if (spec.coerce) existing.coerce = spec.coerce;
        if (spec.default !== undefined) existing.default = spec.default;
        existing.__socket = true;
        next.push(existing);
        kept[existing.id] = 1;
      } else {
        next.push(makeSocket(spec));
      }
    }
    // drop edges that point at ports which no longer exist
    var valid = {};
    for (i = 0; i < next.length; i++) valid[next[i].id] = 1;
    var self = this;
    var dead = [];
    this.edges.forEach(function (edge) {
      var matches = dir === 'output' ? (edge.from === node.id) : (edge.to === node.id);
      if (!matches) return;
      var sockId = dir === 'output' ? edge.fromSocket : edge.toSocket;
      if (!valid[sockId]) dead.push(edge.id);
    });
    for (i = 0; i < dead.length; i++) this.edges.delete(dead[i]);
    if (dir === 'output') node.outputs = next; else node.inputs = next;
    this.touch();
    return dead.length > 0;
  };

  /**
   * Recompute dynamic ports for a node whose definition provides
   * `computePorts(node, ports)`. Existing sockets are reused (ids are kept)
   * as long as their name survives, so links are not broken by a rebuild.
   * Returns true when the node changed.
   */
  Graph.prototype.applyDynamicPorts = function (node) {
    var def = node && node.def;
    if (!def || !isFn(def.computePorts)) return false;
    var spec;
    try {
      spec = def.computePorts(node, { inputs: node.inputs, outputs: node.outputs });
    } catch (e) {
      if (typeof console !== 'undefined') console.error('[node-flow] computePorts failed for ' + node.type, e);
      return false;
    }
    if (!spec) return false;
    var changed = false;
    if (spec.inputs) changed = this._applyPortSpec(node, 'input', spec.inputs) || changed;
    if (spec.outputs) changed = this._applyPortSpec(node, 'output', spec.outputs) || changed;
    if (changed) { this.touch(); this.emit('node:ports', node); }
    return changed;
  };

  Graph.prototype._applyPortSpec = function (node, dir, specs) {
    specs = specs || [];
    var current = dir === 'output' ? node.outputs : node.inputs;
    var same = current.length === specs.length;
    if (same) {
      for (var k = 0; k < specs.length; k++) {
        var s = specs[k];
        var c = current[k];
        if (!c) { same = false; break; }
        if ((s.id && s.id !== c.id) || s.name !== c.name || s.type !== c.type ||
          !!s.multi !== !!c.multi || (s.hint || '') !== (c.hint || '')) { same = false; break; }
      }
    }
    if (same) return false;
    return this.setPorts(node, dir, specs) || true;
  };

  /* --- edges ---------------------------------------------------------- */

  Graph.prototype.edgesOf = function (nodeId) {
    var out = [];
    this.edges.forEach(function (e) { if (e.from === nodeId || e.to === nodeId) out.push(e); });
    return out;
  };

  Graph.prototype.inEdges = function (nodeId, socketId) {
    var out = [];
    this.edges.forEach(function (e) {
      if (e.to !== nodeId) return;
      if (socketId && e.toSocket !== socketId) return;
      out.push(e);
    });
    return out;
  };

  Graph.prototype.outEdges = function (nodeId, socketId) {
    var out = [];
    this.edges.forEach(function (e) {
      if (e.from !== nodeId) return;
      if (socketId && e.fromSocket !== socketId) return;
      out.push(e);
    });
    return out;
  };

  Graph.prototype.edgeBetween = function (fromId, fromSock, toId, toSock) {
    var found = null;
    this.edges.forEach(function (e) {
      if (found) return;
      if (e.from === fromId && e.fromSocket === fromSock && e.to === toId && e.toSocket === toSock) found = e;
    });
    return found;
  };

  /**
   * Connect two sockets. Returns the new edge, or null when the link is
   * invalid/duplicate. An input that is not `multi` keeps a single link.
   */
  Graph.prototype.connect = function (fromNode, fromSock, toNode, toSock, opts) {
    opts = opts || {};
    if (!fromNode || !fromSock || !toNode || !toSock) return null;
    if (fromNode.id === toNode.id) return null;                 // no self links
    if (this.edgeBetween(fromNode.id, fromSock.id, toNode.id, toSock.id)) return null;
    if (!toSock.multi || opts.replace) {
      // single input: an implicit link is replaced
      var self = this;
      var remove = [];
      this.edges.forEach(function (e) { if (e.to === toNode.id && e.toSocket === toSock.id) remove.push(e.id); });
      for (var i = 0; i < remove.length; i++) this.edges.delete(remove[i]);
    }
    var edge = makeEdge(fromNode.id, fromSock, toNode.id, toSock, opts.edge);
    this.edges.set(edge.id, edge);
    this.touch();
    this.emit('edge:add', edge);
    return edge;
  };

  /** Node-based convenience used by the UI and by serialisation. */
  Graph.prototype.connectIds = function (fromId, fromSockId, toId, toSockId) {
    return this.connect(
      this.nodes.get(fromId), findSocket(this.nodes.get(fromId), 'output', fromSockId),
      this.nodes.get(toId), findSocket(this.nodes.get(toId), 'input', toSockId)
    );
  };

  Graph.prototype.disconnect = function (edgeOrId) {
    var edge = typeof edgeOrId === 'string' ? this.edges.get(edgeOrId) : edgeOrId;
    if (!edge) return false;
    this.edges.delete(edge.id);
    this.touch();
    this.emit('edge:remove', edge);
    return true;
  };

  Graph.prototype.removeEdgesOf = function (nodeId) {
    var remove = [];
    this.edges.forEach(function (e) { if (e.from === nodeId || e.to === nodeId) remove.push(e.id); });
    for (var i = 0; i < remove.length; i++) this.edges.delete(remove[i]);
    return remove.length;
  };

  /**
   * Would connecting these two sockets create a cycle?
   * (Links run from an output of `fromNode` into an input of `toNode`, so a
   * cycle exists when `fromNode` is reachable downstream from `toNode`.)
   */
  Graph.prototype.wouldCycle = function (fromNodeId, toNodeId) {
    if (fromNodeId === toNodeId) return true;
    var adj = new Map();
    this.edges.forEach(function (e) {
      var list = adj.get(e.from);
      if (!list) { list = []; adj.set(e.from, list); }
      list.push(e.to);
    });
    var stack = [toNodeId], seen = {};
    while (stack.length) {
      var id = stack.pop();
      if (id === fromNodeId) return true;
      if (seen[id]) continue;
      seen[id] = 1;
      var next = adj.get(id);
      if (next) for (var i = 0; i < next.length; i++) stack.push(next[i]);
    }
    return false;
  };

  Graph.prototype.hasCycle = function () {
    var order = this.topoOrder();
    return order === null;
  };

  /** Kahn topological order; returns null when the graph has a cycle. */
  Graph.prototype.topoOrder = function () {
    var indeg = new Map(), adj = new Map(), self = this;
    this.nodes.forEach(function (n) { indeg.set(n.id, 0); adj.set(n.id, []); });
    this.edges.forEach(function (e) {
      if (!self.nodes.has(e.from) || !self.nodes.has(e.to)) return;
      adj.get(e.from).push(e.to);
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    });
    var queue = [];
    indeg.forEach(function (d, id) { if (d === 0) queue.push(id); });
    var order = [];
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      var next = adj.get(id) || [];
      for (var i = 0; i < next.length; i++) {
        var d = indeg.get(next[i]) - 1;
        indeg.set(next[i], d);
        if (d === 0) queue.push(next[i]);
      }
    }
    if (order.length !== this.nodes.size) return null;
    return order;
  };

  /* --- serialisation --------------------------------------------------- */

  Graph.prototype.serialize = function () {
    var nodes = [], edges = [];
    this.nodes.forEach(function (n) { nodes.push(serializeNode(n)); });
    this.edges.forEach(function (e) { edges.push(serializeEdge(e)); });
    return {
      format: DOC_FORMAT,
      version: DOC_VERSION,
      generator: 'node-flow ' + VERSION,
      meta: clone(this.meta),
      nodes: nodes,
      edges: edges,
      view: this.view ? clone(this.view) : undefined
    };
  };

  /** Load a document. Unknown node types are kept as inert placeholder nodes. */
  Graph.prototype.load = function (doc, opts) {
    opts = opts || {};
    if (typeof doc === 'string') doc = JSON.parse(doc);
    if (!doc || !isArr(doc.nodes)) throw new Error('Malformed graph document');
    if (!opts.merge) {
      this.nodes = new Map();
      this.edges = new Map();
      this._byType = null;
    }
    this.meta = assign({ name: 'Untitled graph', description: '', created: null }, doc.meta || {});
    if (doc.view) this.view = clone(doc.view);

    var i, rec, def, node, missing = [];
    for (i = 0; i < doc.nodes.length; i++) {
      rec = doc.nodes[i];
      def = this.registry ? this.registry.get(rec.type) : null;
      if (!def) {
        missing.push(rec.type);
        def = {
          type: rec.type,
          title: rec.title || rec.type,
          category: 'unknown',
          color: '#8a4a4a',
          inputs: [], outputs: [],
          placeholder: true
        };
      }
      node = makeNode(def, rec);
      node.id = rec.id || node.id;
      this.nodes.set(node.id, node);
    }
    for (i = 0; i < doc.edges.length; i++) {
      var e = doc.edges[i];
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      var edge = {
        id: e.id || uid('e'),
        from: e.from, fromSocket: e.fromSocket,
        to: e.to, toSocket: e.toSocket,
        type: e.type || 'any'
      };
      this.edges.set(edge.id, edge);
    }
    // drop dangling links (ports removed by an older version of the node)
    var dead = [];
    var self = this;
    this.edges.forEach(function (edge) {
      var f = self.nodes.get(edge.from), t = self.nodes.get(edge.to);
      if (!findSocket(f, 'output', edge.fromSocket) || !findSocket(t, 'input', edge.toSocket)) dead.push(edge.id);
    });
    for (i = 0; i < dead.length; i++) this.edges.delete(dead[i]);

    this.touch();
    this.emit('load', this);
    return { missing: missing };
  };

  Graph.prototype.clear = function () {
    this.nodes = new Map();
    this.edges = new Map();
    this._byType = null;
    this.touch();
    this.emit('clear', this);
  };

  Graph.prototype.stats = function () {
    var s = { nodes: this.nodes.size, edges: this.edges.size, categories: {} };
    this.nodes.forEach(function (n) {
      var cat = (n.def && n.def.category) || 'other';
      s.categories[cat] = (s.categories[cat] || 0) + 1;
    });
    return s;
  };

  /* =======================================================================
   * 4b. Connection-data API
   *
   * This is what a host application consumes: a plain, resolved view of the
   * node graph (which socket feeds which socket, what value a socket carries)
   * without needing to walk the internal Maps itself.
   * ===================================================================== */

  function describeSocket(graph, node, socket, dir) {
    var links = [];
    graph.edges.forEach(function (edge) {
      var isThis = dir === 'output'
        ? (edge.from === node.id && edge.fromSocket === socket.id)
        : (edge.to === node.id && edge.toSocket === socket.id);
      if (!isThis) return;
      var otherId = dir === 'output' ? edge.to : edge.from;
      var otherSocket = dir === 'output' ? edge.toSocket : edge.fromSocket;
      links.push({ edge: edge.id, node: otherId, socket: otherSocket, type: edge.type });
    });
    return {
      id: socket.id,
      name: socket.name,
      type: socket.type,
      multi: !!socket.multi,
      default: clone(socket.default),
      links: links
    };
  }

  /**
   * Flat, resolved description of one node.
   *   { id, type, title, x, y, w, h, collapsed, muted, locked, comment,
   *     body, custom, inputs:[{name,type,linked,links}], outputs:[...] }
   */
  Graph.prototype.inspect = function (idOrNode) {
    var node = typeof idOrNode === 'string' ? this.nodes.get(idOrNode) : idOrNode;
    if (!node) return null;
    var self = this;
    var inputs = [], outputs = [], i;
    for (i = 0; i < node.inputs.length; i++) {
      inputs.push(describeSocket(this, node, node.inputs[i], 'input'));
    }
    for (i = 0; i < node.outputs.length; i++) {
      outputs.push(describeSocket(this, node, node.outputs[i], 'output'));
    }
    return {
      id: node.id, type: node.type, title: node.title,
      x: node.x, y: node.y, w: node.w, h: node.h || 0,
      collapsed: !!node.collapsed, muted: !!node.muted, locked: !!node.locked,
      comment: node.comment || '',
      body: clone(node.body),
      custom: clone(node.custom || {}),
      inputs: inputs, outputs: outputs
    };
  };

  /**
   * The whole graph as connection data - the format a generator/interpreter
   * would consume. Links are always emitted output -> input.
   */
  Graph.prototype.toData = function () {
    var self = this;
    var nodes = [], links = [];
    this.nodes.forEach(function (n) { nodes.push(self.inspect(n)); });
    this.edges.forEach(function (e) {
      var from = self.nodes.get(e.from);
      var to = self.nodes.get(e.to);
      if (!from || !to) return;
      var fromSock = findSocket(from, 'output', e.fromSocket);
      var toSock = findSocket(to, 'input', e.toSocket);
      links.push({
        id: e.id,
        type: e.type,
        from: { node: e.from, socket: e.fromSocket, name: fromSock ? fromSock.name : null, dataType: fromSock ? fromSock.type : null },
        to: { node: e.to, socket: e.toSocket, name: toSock ? toSock.name : null, dataType: toSock ? toSock.type : null }
      });
    });
    return { meta: clone(this.meta), nodes: nodes, links: links };
  };

  /** Simple adjacency helpers for host-side graph walking. */
  Graph.prototype.downstream = function (nodeId, includeSelf) {
    var out = [], stack = [nodeId], seen = {};
    while (stack.length) {
      var id = stack.pop();
      if (seen[id]) continue;
      seen[id] = 1;
      if (includeSelf || id !== nodeId) out.push(id);
      this.edges.forEach(function (e) { if (e.from === id) stack.push(e.to); });
    }
    return out;
  };

  Graph.prototype.upstream = function (nodeId, includeSelf) {
    var out = [], stack = [nodeId], seen = {};
    while (stack.length) {
      var id = stack.pop();
      if (seen[id]) continue;
      seen[id] = 1;
      if (includeSelf || id !== nodeId) out.push(id);
      this.edges.forEach(function (e) { if (e.to === id) stack.push(e.from); });
    }
    return out;
  };

  /* =======================================================================
   * 5. Node type registry
   * ===================================================================== */

  function NodeRegistry() {
    this.types = new Map();
    this.categories = [];
    this._categoryIndex = {};
  }

  /**
   * Register a node type - this is how users define their own nodes.
   * Definition fields (all optional except `type`):
   *   type        unique id, e.g. 'my/image-filter'
   *   title       caption in the header
   *   category    grouping in the add menu
   *   keywords    extra search terms for the add menu
   *   color       header colour
   *   headerColor alias of color
   *   dotColor    little square in the header
   *   icon        short glyph or emoji
   *   description tooltip / help text
   *   width       preferred node width in graph units
   *   inputs      [{ id, name, type, default, multi, hint, accept, widget }]
   *   outputs     [{ id, name, type, multi, hint }]
   *   body        [{ key, type, label, value, ...widget options }]
   *   preview     true to reserve a live-preview area in the node body
   *   init        (node) -> void, runs right after the node is constructed
   *   computePorts(node, ports) -> { inputs, outputs }   dynamic ports
   *   render      (node, api) -> HTMLElement              custom body renderer
   *   onBodyChange(node, key, value, api) -> void          widget side effects
   *
   * The registry stores *descriptions* only. Nothing here evaluates a graph;
   * the host reads graph.serialize() / the change events and decides what the
   * node graph means.
   */
  NodeRegistry.prototype.register = function (defs) {
    var list = isArr(defs) ? defs : [defs];
    for (var i = 0; i < list.length; i++) {
      var def = list[i];
      if (!def || !def.type) throw new Error('node definition needs a "type"');
      def = defaults(def, { title: def.type, category: 'misc', keywords: [], body: [], inputs: [], outputs: [] });
      this.types.set(def.type, def);
      if (!this._categoryIndex[def.category]) {
        this._categoryIndex[def.category] = [];
        this.categories.push(def.category);
      }
      if (this._categoryIndex[def.category].indexOf(def) < 0) this._categoryIndex[def.category].push(def);
    }
    return this;
  };

  NodeRegistry.prototype.unregister = function (type) {
    var def = this.types.get(type);
    if (!def) return false;
    this.types.delete(type);
    var list = this._categoryIndex[def.category];
    if (list) {
      var i = list.indexOf(def);
      if (i >= 0) list.splice(i, 1);
    }
    return true;
  };

  NodeRegistry.prototype.get = function (type) { return this.types.get(type) || null; };

  NodeRegistry.prototype.byCategory = function () {
    var out = [];
    for (var i = 0; i < this.categories.length; i++) {
      var cat = this.categories[i];
      var list = this._categoryIndex[cat];
      if (list && list.length) out.push({ category: cat, nodes: list.slice() });
    }
    return out;
  };

  /** Ranked substring search over title / type / keywords / category. */
  NodeRegistry.prototype.search = function (query, limit) {
    var q = String(query || '').trim().toLowerCase();
    var scored = [];
    this.types.forEach(function (def) {
      var score = 0;
      var hay = (def.title + ' ' + def.type + ' ' + (def.keywords || []).join(' ') + ' ' + def.category).toLowerCase();
      if (!q) score = 1;
      else if (def.title.toLowerCase().indexOf(q) === 0) score = 100;
      else if (def.type.toLowerCase().indexOf(q) === 0) score = 90;
      else if ((def.keywords || []).join(' ').toLowerCase().indexOf(q) >= 0) score = 70;
      else if (hay.indexOf(q) >= 0) score = 50;
      else {
        // subsequence match ("cmb" -> "combine")
        var qi = 0;
        for (var i = 0; i < hay.length && qi < q.length; i++) if (hay.charAt(i) === q.charAt(qi)) qi++;
        if (qi === q.length) score = 20;
      }
      if (score > 0) scored.push({ def: def, score: score });
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.def.title < b.def.title ? -1 : 1;
    });
    return scored.slice(0, limit || 40).map(function (s) { return s.def; });
  };

  /* =======================================================================
   * 6. Undo/redo history
   * ===================================================================== */

  function History(graph, limit) {
    this.graph = graph;
    this.limit = limit || 120;
    this.undoStack = [];
    this.redoStack = [];
    this._pending = null;
    this._pendingLabel = '';
  }

  History.prototype.snapshot = function () {
    return { data: JSON.stringify(this.graph.serialize()), version: this.graph.version };
  };

  /** Call before a mutation; repeated calls before commit() are ignored. */
  History.prototype.begin = function (label) {
    if (this._pending) return;
    this._pending = this.snapshot();
    this._pendingLabel = label || 'edit';
  };

  /** Commit the pending snapshot if the graph actually changed. */
  History.prototype.commit = function () {
    if (!this._pending) return false;
    if (this._pending.version === this.graph.version) {
      this._pending = null;
      return false;
    }
    this.undoStack.push({ label: this._pendingLabel, data: this._pending.data, version: this._pending.version });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._pending = null;
    this.graph.emit('history', this);
    return true;
  };

  History.prototype.abort = function () { this._pending = null; };

  History.prototype.canUndo = function () { return this.undoStack.length > 0; };
  History.prototype.canRedo = function () { return this.redoStack.length > 0; };

  History.prototype.undo = function () {
    if (!this.undoStack.length) return false;
    var entry = this.undoStack.pop();
    this.redoStack.push({ label: entry.label, data: JSON.stringify(this.graph.serialize()), version: this.graph.version });
    this.graph.load(JSON.parse(entry.data));
    this.graph.emit('history', this);
    return true;
  };

  History.prototype.redo = function () {
    if (!this.redoStack.length) return false;
    var entry = this.redoStack.pop();
    this.undoStack.push({ label: entry.label, data: JSON.stringify(this.graph.serialize()), version: this.graph.version });
    this.graph.load(JSON.parse(entry.data));
    this.graph.emit('history', this);
    return true;
  };

  /* =======================================================================
   * 7. Exports
   * ===================================================================== */

  return {
    VERSION: VERSION,
    DOC_FORMAT: DOC_FORMAT,
    DOC_VERSION: DOC_VERSION,

    // utils
    uid: uid, clamp: clamp, clone: clone, assign: assign, defaults: defaults,
    isArr: isArr, isObj: isObj, isFn: isFn, isNum: isNum, noop: noop, debounce: debounce,

    // geometry
    Geo: Geo,

    // types
    TYPE_COLORS: TYPE_COLORS,
    SocketTypes: SocketTypes,
    colorOfType: colorOfType,
    typesCompatible: typesCompatible,
    socketAccepts: socketAccepts,
    coerce: coerce,
    coerceChecked: coerceChecked,
    toNum: toNum, toBool: toBool, toStr: toStr, toVec: toVec, toColor: toColor, toList: toList,
    defaultForType: defaultForType,

    // model
    makeSocket: makeSocket,
    makeEdge: makeEdge,
    makeNode: makeNode,
    serializeNode: serializeNode,
    serializeEdge: serializeEdge,
    findSocket: findSocket,

    // classes
    Graph: Graph,
    NodeRegistry: NodeRegistry,
    History: History
  };
});
