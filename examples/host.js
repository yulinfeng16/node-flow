/*!
 * node-flow / examples/host.js
 * ---------------------------------------------------------------------------
 * THE HOST SIDE OF THE DEMO - not part of the library.
 *
 * The library gives you a node document; this file is one example of what an
 * application can *do* with it. It walks the connection data returned by
 * graph.toData(), asks each node definition's `compute` for its outputs, puts
 * the results back into the editor as node previews, and writes a log.
 *
 * A different host could instead compile the same document to JavaScript, to
 * shader code, to a SQL query, or to a sequence of Blender operations - the
 * editor does not care.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NodeFlowHost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_STEPS = 5000;

  function str(v) {
    if (v === null || v === undefined) return '\u2014';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return '[' + v.length + '] ' + v.slice(0, 12).map(str).join(', ') + (v.length > 12 ? ', \u2026' : '');
    }
    if (typeof v === 'object' && typeof v.x === 'number') return '(' + str(v.x) + ', ' + str(v.y) + ', ' + str(v.z) + ')';
    if (typeof v === 'object' && typeof v.r === 'number') {
      return 'rgb(' + Math.round(v.r * 255) + ', ' + Math.round(v.g * 255) + ', ' + Math.round(v.b * 255) + ')';
    }
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  /**
   * Evaluate a graph document.
   *
   * @param {object} graph      NG.Graph instance
   * @param {object} [options]  { onNode(node, outputs, error), log(message, level) }
   * @returns {{values: Map, previews: Map, errors: Map, order: string[], log: Array}}
   */
  function evaluate(graph, options) {
    options = options || {};
    var log = [];
    function emit(message, level) {
      log.push({ message: message, level: level || 'info' });
      if (options.log) options.log(message, level || 'info');
    }

    var order = graph.topoOrder();
    if (order === null) {
      emit('Graph contains a cycle - evaluation skipped', 'error');
      return { values: new Map(), previews: new Map(), errors: new Map(), order: [], log: log, cyclic: true };
    }
    if (order.length > MAX_STEPS) order = order.slice(0, MAX_STEPS);

    var values = new Map();     // "nodeId:socketName" -> value
    var previews = new Map();   // nodeId -> preview text
    var errors = new Map();     // nodeId -> message
    var byId = new Map();
    graph.nodes.forEach(function (n) { byId.set(n.id, n); });

    for (var i = 0; i < order.length; i++) {
      var node = byId.get(order[i]);
      if (!node) continue;
      var def = node.def || {};

      // gather inputs, honouring multi-inputs and muted nodes
      var inputs = {};
      for (var k = 0; k < node.inputs.length; k++) {
        var sock = node.inputs[k];
        var incoming = graph.inEdges(node.id, sock.id);
        if (sock.multi) {
          var many = [];
          for (var m = 0; m < incoming.length; m++) {
            var src = byId.get(incoming[m].from);
            var srcSock = src && findOutput(src, incoming[m].fromSocket);
            if (srcSock) many.push(values.get(src.id + ':' + srcSock.name));
          }
          inputs[sock.name] = many;
        } else if (incoming.length && !node.muted) {
          var source = byId.get(incoming[0].from);
          var outSock = source && findOutput(source, incoming[0].fromSocket);
          inputs[sock.name] = outSock ? values.get(source.id + ':' + outSock.name) : undefined;
        } else {
          inputs[sock.name] = sock.default;
        }
      }

      var outputs = {};
      if (node.muted) {
        emit('skipped muted node "' + node.title + '"', 'muted');
      } else if (typeof def.compute === 'function') {
        try {
          if (!node.state) node.state = { error: null, running: false, preview: null };
          if (typeof def.createState === 'function' && !node._demoState) node._demoState = def.createState();
          outputs = def.compute(node, inputs, node._demoState || {}) || {};
        } catch (e) {
          errors.set(node.id, e.message);
          emit(node.title + ': ' + e.message, 'error');
          outputs = {};
        }
      } else if (def.terminal) {
        outputs = {};
      }

      for (var key in outputs) {
        if (Object.prototype.hasOwnProperty.call(outputs, key)) values.set(node.id + ':' + key, outputs[key]);
      }
      node._outputs = outputs;                 // handy for host-side inspection
      if (def.terminal) node._result = outputs.value;

      // hand results back for the inline previews
      var lines = [];
      if (errors.has(node.id)) lines.push('\u2715 ' + errors.get(node.id));
      for (var oi = 0; oi < node.outputs.length; oi++) {
        var os = node.outputs[oi];
        var val = values.get(node.id + ':' + os.name);
        if (val !== undefined) lines.push(os.name + ' = ' + str(val));
      }
      for (var ii = 0; ii < node.inputs.length; ii++) {
        var is = node.inputs[ii];
        if (is.multi) {
          var list = inputs[is.name] || [];
          if (list.length) lines.push(is.name + ' \u2190 ' + list.length + ' item(s)');
        }
      }
      var preview = lines.join('\n');
      if (preview) previews.set(node.id, preview);
      if (options.onNode) options.onNode(node, outputs, errors.get(node.id) || null);
    }

    return { values: values, previews: previews, errors: errors, order: order, log: log, cyclic: false };
  }

  function findOutput(node, socketId) {
    for (var i = 0; i < node.outputs.length; i++) if (node.outputs[i].id === socketId) return node.outputs[i];
    return null;
  }

  return { evaluate: evaluate, stringify: str };
});
