/*!
 * node-flow / examples/nodes-example.js
 * ---------------------------------------------------------------------------
 * AN EXAMPLE NODE SET - not part of the library.
 *
 * This file is what "the user defines the nodes" looks like. The editor only
 * stores the description below (titles, sockets, widgets, colours); it never
 * reads `compute`. The demo host (host.js) reads the graph's connection data
 * and calls `compute` itself. Delete this file or replace it entirely - the
 * library does not depend on any node type.
 *
 * Load it as an ES module...
 *     import { exampleNodes } from './nodes-example.js';
 * ...or as a classic script (it also attaches window.ExampleNodes).
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExampleNodes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---- helpers used by the example nodes only -------------------------- */

  function n(v) { var x = typeof v === 'number' ? v : parseFloat(v); return isFinite(x) ? x : 0; }
  function s(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  function b(v) { return v === true || v === 'true' || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v !== 'false' && v !== '0'); }
  /**
   * Format a value for display: numbers are rounded to `digits` decimals so
   * floating point noise (15.209999999999999) never reaches the user.
   */
  function fmt(v, digits) {
    digits = digits === undefined ? 4 : digits;
    if (typeof v === 'number' && isFinite(v)) {
      var rounded = Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits);
      return String(rounded);
    }
    return s(v);
  }
  function isList(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function asList(v) { return isList(v) ? v : (v === undefined || v === null ? [] : [v]); }

  /**
   * Evaluate a tiny expression language safely (no eval / new Function) so the
   * example can ship an "Expression" node. Supports + - * / % ^, parentheses,
   * comparisons, and the identifiers supplied by the caller.
   */
  function evalExpression(src, vars) {
    var i = 0;
    var text = String(src || '');
    function ws() { while (i < text.length && /\s/.test(text.charAt(i))) i++; }
    function peek() { ws(); return text.charAt(i); }
    function eat(ch) { ws(); if (text.charAt(i) === ch) { i++; return true; } return false; }

    function parsePrimary() {
      ws();
      var ch = text.charAt(i);
      if (ch === '(') { i++; var v = parseExpr(); eat(')'); return v; }
      if (ch === '-') { i++; return -parsePrimary(); }
      if (ch === '+') { i++; return parsePrimary(); }
      var m = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(text.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      var id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
      if (id) {
        i += id[0].length;
        var name = id[0];
        if (name === 'pi') return Math.PI;
        if (name === 'e') return Math.E;
        if (Object.prototype.hasOwnProperty.call(vars, name)) return n(vars[name]);
        throw new Error('unknown name "' + name + '"');
      }
      throw new Error('unexpected "' + text.charAt(i) + '" in expression');
    }
    function parsePower() {
      var left = parsePrimary();
      if (peek() === '^') { i++; return Math.pow(left, parsePower()); }
      return left;
    }
    function parseTerm() {
      var left = parsePower();
      for (;;) {
        var ch = peek();
        if (ch === '*') { i++; left *= parsePower(); }
        else if (ch === '/') { i++; var d = parsePower(); left = d === 0 ? 0 : left / d; }
        else if (ch === '%') { i++; var m = parsePower(); left = m === 0 ? 0 : left % m; }
        else return left;
      }
    }
    function parseSum() {
      var left = parseTerm();
      for (;;) {
        var ch = peek();
        if (ch === '+') { i++; left += parseTerm(); }
        else if (ch === '-') { i++; left -= parseTerm(); }
        else return left;
      }
    }
    function parseCompare() {
      var left = parseSum();
      ws();
      var two = text.substr(i, 2), one = text.charAt(i);
      if (two === '==') { i += 2; return left === parseSum() ? 1 : 0; }
      if (two === '!=') { i += 2; return left !== parseSum() ? 1 : 0; }
      if (two === '>=') { i += 2; return left >= parseSum() ? 1 : 0; }
      if (two === '<=') { i += 2; return left <= parseSum() ? 1 : 0; }
      if (one === '>') { i++; return left > parseSum() ? 1 : 0; }
      if (one === '<') { i++; return left < parseSum() ? 1 : 0; }
      return left;
    }
    function parseExpr() { return parseCompare(); }

    var value = parseExpr();
    ws();
    if (i < text.length) throw new Error('unexpected "' + text.charAt(i) + '"');
    return value;
  }

  /* ---- the example node definitions ----------------------------------- */

  var C = {
    input: '#3c6e52',
    output: '#7c3b52',
    math: '#3a5a7a',
    logic: '#6d4a7a',
    text: '#6a5a2a',
    list: '#2f6b66',
    util: '#4a4a4a'
  };

  var nodes = [
    /* ---------------------------------------------------------- values */
    {
      type: 'value/number', title: 'Number', category: 'Values', icon: '#', color: C.input,
      keywords: ['float', 'int', 'value'], width: 180,
      outputs: [{ name: 'Value', type: 'number' }],
      body: [{ key: 'value', type: 'number', label: 'Value', value: 5, step: 1 }],
      compute: function (node) { return { Value: n(node.body.value) }; }
    },
    {
      type: 'value/slider', title: 'Slider', category: 'Values', icon: '\u2194', color: C.input,
      keywords: ['range', 'float'], width: 200,
      outputs: [{ name: 'Value', type: 'number' }],
      body: [{ key: 'value', type: 'range', label: 'Value', value: 0.5, min: 0, max: 1, step: 0.01 }],
      compute: function (node) { return { Value: n(node.body.value) }; }
    },
    {
      type: 'value/text', title: 'Text', category: 'Values', icon: 'T', color: C.input,
      keywords: ['string', 'label'], width: 220,
      outputs: [{ name: 'Text', type: 'string' }],
      body: [{ key: 'text', type: 'text', value: 'hello', placeholder: 'type something' }],
      compute: function (node) { return { Text: s(node.body.text) }; }
    },
    {
      type: 'value/note', title: 'Note', category: 'Values', icon: '\u2261', color: C.util,
      keywords: ['comment', 'text'], width: 240,
      outputs: [{ name: 'Text', type: 'string' }],
      body: [{ key: 'text', type: 'textarea', value: 'A longer piece of text.\nSupports multiple lines.', rows: 4 }],
      compute: function (node) { return { Text: s(node.body.text) }; }
    },
    {
      type: 'value/toggle', title: 'Toggle', category: 'Values', icon: '\u2713', color: C.input,
      keywords: ['bool', 'boolean', 'check'], width: 170,
      outputs: [{ name: 'Value', type: 'bool' }],
      body: [{ key: 'value', type: 'check', value: true, label: 'Enabled' }],
      compute: function (node) { return { Value: !!node.body.value }; }
    },
    {
      type: 'value/select', title: 'Dropdown', category: 'Values', icon: '\u25BE', color: C.input,
      keywords: ['option', 'choice', 'enum'], width: 200,
      outputs: [{ name: 'Text', type: 'string' }],
      body: [{
        key: 'value', type: 'select', value: 'b',
        options: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }, { value: 'c', label: 'Option C' }]
      }],
      compute: function (node) { return { Text: s(node.body.value) }; }
    },
    {
      type: 'value/vector', title: 'Vector', category: 'Values', icon: '\u2197', color: C.input,
      keywords: ['xyz', 'vec3'], width: 240,
      outputs: [{ name: 'Vector', type: 'vector' }],
      body: [{ key: 'value', type: 'vector', value: { x: 1, y: 0, z: 0 }, axes: ['x', 'y', 'z'], step: 0.1 }],
      compute: function (node) { return { Vector: node.body.value }; }
    },
    {
      type: 'value/color', title: 'Color', category: 'Values', icon: '\u25CF', color: C.input,
      keywords: ['rgb', 'colour'], width: 200,
      outputs: [{ name: 'Color', type: 'color' }],
      body: [{ key: 'value', type: 'color', value: { r: 0.95, g: 0.65, b: 0.25, a: 1 } }],
      compute: function (node) { return { Color: node.body.value }; }
    },

    /* ------------------------------------------------------------ math */
    {
      type: 'math/binary', title: 'Math', category: 'Math', icon: '\u00F7', color: C.math,
      keywords: ['add', 'subtract', 'multiply', 'divide', 'plus', 'minus', 'times'], width: 210,
      inputs: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number' }],
      outputs: [{ name: 'Result', type: 'number' }],
      body: [{
        key: 'op', type: 'select', value: 'add',
        options: [
          { value: 'add', label: 'Add  A + B' }, { value: 'sub', label: 'Subtract  A - B' },
          { value: 'mul', label: 'Multiply  A * B' }, { value: 'div', label: 'Divide  A / B' },
          { value: 'mod', label: 'Modulo  A % B' }, { value: 'pow', label: 'Power  A ^ B' },
          { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' },
          { value: 'atan2', label: 'Angle  atan2(A, B)' }
        ]
      }],
      compute: function (node, in_) {
        var a = n(in_.A), bb = n(in_.B);
        switch (node.body.op) {
          case 'sub': return { Result: a - bb };
          case 'mul': return { Result: a * bb };
          case 'div': return { Result: bb === 0 ? 0 : a / bb };
          case 'mod': return { Result: bb === 0 ? 0 : a % bb };
          case 'pow': return { Result: Math.pow(a, bb) };
          case 'min': return { Result: Math.min(a, bb) };
          case 'max': return { Result: Math.max(a, bb) };
          case 'atan2': return { Result: Math.atan2(a, bb) };
          default: return { Result: a + bb };
        }
      }
    },
    {
      type: 'math/unary', title: 'Unary Math', category: 'Math', icon: 'f', color: C.math,
      keywords: ['abs', 'round', 'floor', 'ceil', 'sqrt', 'sin', 'cos', 'sign'], width: 200,
      inputs: [{ name: 'Value', type: 'number' }],
      outputs: [{ name: 'Result', type: 'number' }],
      body: [{
        key: 'op', type: 'select', value: 'abs',
        options: ['abs', 'round', 'floor', 'ceil', 'sqrt', 'sign', 'sin', 'cos', 'tan', 'log', 'exp']
      }],
      compute: function (node, in_) {
        var v = n(in_.Value);
        switch (node.body.op) {
          case 'round': return { Result: Math.round(v) };
          case 'floor': return { Result: Math.floor(v) };
          case 'ceil': return { Result: Math.ceil(v) };
          case 'sqrt': return { Result: v < 0 ? 0 : Math.sqrt(v) };
          case 'sign': return { Result: v > 0 ? 1 : (v < 0 ? -1 : 0) };
          case 'sin': return { Result: Math.sin(v) };
          case 'cos': return { Result: Math.cos(v) };
          case 'tan': return { Result: Math.tan(v) };
          case 'log': return { Result: v <= 0 ? 0 : Math.log(v) };
          case 'exp': return { Result: Math.exp(v) };
          default: return { Result: Math.abs(v) };
        }
      }
    },
    {
      type: 'math/clamp', title: 'Clamp', category: 'Math', icon: '\u22A5', color: C.math,
      keywords: ['limit', 'range', 'min', 'max'], width: 210,
      inputs: [{ name: 'Value', type: 'number' }, { name: 'Min', type: 'number', default: 0 }, { name: 'Max', type: 'number', default: 1 }],
      outputs: [{ name: 'Result', type: 'number' }],
      compute: function (node, in_) {
        return { Result: Math.min(Math.max(n(in_.Value), n(in_.Min)), n(in_.Max)) };
      }
    },
    {
      type: 'math/lerp', title: 'Interpolate', category: 'Math', icon: '\u2192', color: C.math,
      keywords: ['lerp', 'mix', 'blend', 'map range'], width: 220,
      inputs: [
        { name: 'Factor', type: 'number', default: 0.5 },
        { name: 'From Min', type: 'number', default: 0 }, { name: 'From Max', type: 'number', default: 1 },
        { name: 'To Min', type: 'number', default: 0 }, { name: 'To Max', type: 'number', default: 100 }
      ],
      outputs: [{ name: 'Result', type: 'number' }],
      compute: function (node, in_) {
        var f0 = n(in_['From Min']), f1 = n(in_['From Max']);
        var t0 = n(in_['To Min']), t1 = n(in_['To Max']);
        var f = n(in_.Factor);
        var span = f1 - f0;
        var p = span === 0 ? 0 : (f - f0) / span;
        return { Result: t0 + p * (t1 - t0) };
      }
    },
    {
      type: 'math/expression', title: 'Expression', category: 'Math', icon: 'fx', color: C.math,
      keywords: ['formula', 'calculate', 'custom'], width: 240,
      inputs: [
        { name: 'a', type: 'number', default: 1 },
        { name: 'b', type: 'number', default: 2 },
        { name: 'c', type: 'number', default: 0 }
      ],
      outputs: [{ name: 'Result', type: 'number' }, { name: 'Error', type: 'string' }],
      body: [{ key: 'expr', type: 'code', value: '(a + b) * 2', rows: 2, placeholder: 'e.g. sqrt(a^2 + b^2)' }],
      compute: function (node, in_) {
        try {
          return { Result: evalExpression(node.body.expr, { a: in_.a, b: in_.b, c: in_.c }), Error: '' };
        } catch (e) {
          return { Result: 0, Error: e.message };
        }
      }
    },
    {
      type: 'math/random', title: 'Random', category: 'Math', icon: '\u2684', color: C.math,
      keywords: ['rand', 'chance', 'dice'], width: 210,
      inputs: [{ name: 'Min', type: 'number', default: 0 }, { name: 'Max', type: 'number', default: 1 }],
      outputs: [{ name: 'Value', type: 'number' }],
      body: [{ key: 'seed', type: 'int', label: 'Seed', value: 1, min: 0, max: 9999 }],
      compute: function (node, in_) {
        var lo = n(in_.Min), hi = n(in_.Max);
        var t = Math.abs(Math.sin(n(node.body.seed) * 12.9898) * 43758.5453);
        var frac = t - Math.floor(t);
        return { Value: lo + frac * (hi - lo) };
      }
    },

    /* ----------------------------------------------------------- logic */
    {
      type: 'logic/compare', title: 'Compare', category: 'Logic', icon: '\u2260', color: C.logic,
      keywords: ['equal', 'greater', 'less', 'if'], width: 210,
      inputs: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number', default: 1 }],
      outputs: [{ name: 'Result', type: 'bool' }],
      body: [{ key: 'op', type: 'select', value: 'gt', options: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] }],
      compute: function (node, in_) {
        var a = n(in_.A), bb = n(in_.B);
        switch (node.body.op) {
          case 'gte': return { Result: a >= bb };
          case 'lt': return { Result: a < bb };
          case 'lte': return { Result: a <= bb };
          case 'eq': return { Result: a === bb };
          case 'neq': return { Result: a !== bb };
          default: return { Result: a > bb };
        }
      }
    },
    {
      type: 'logic/gate', title: 'Logic Gate', category: 'Logic', icon: '\u2227', color: C.logic,
      keywords: ['and', 'or', 'not', 'xor', 'boolean'], width: 210,
      inputs: [{ name: 'A', type: 'bool', default: true }, { name: 'B', type: 'bool', default: false }],
      outputs: [{ name: 'Result', type: 'bool' }],
      body: [{ key: 'op', type: 'select', value: 'and', options: ['and', 'or', 'xor', 'nand', 'nor', 'not A'] }],
      compute: function (node, in_) {
        var a = b(in_.A), c = b(in_.B);
        switch (node.body.op) {
          case 'or': return { Result: a || c };
          case 'xor': return { Result: a !== c };
          case 'nand': return { Result: !(a && c) };
          case 'nor': return { Result: !(a || c) };
          case 'not A': return { Result: !a };
          default: return { Result: a && c };
        }
      }
    },
    {
      type: 'logic/switch', title: 'Switch', category: 'Logic', icon: '\u21C6', color: C.logic,
      keywords: ['if', 'then', 'else', 'branch', 'condition'], width: 200,
      inputs: [
        { name: 'Condition', type: 'bool', default: true },
        { name: 'If True', type: 'any' },
        { name: 'If False', type: 'any' }
      ],
      outputs: [{ name: 'Result', type: 'any' }],
      compute: function (node, in_) {
        return { Result: b(in_.Condition) ? in_['If True'] : in_['If False'] };
      }
    },

    /* ------------------------------------------------------------ text */
    {
      type: 'text/join', title: 'Join Text', category: 'Text', icon: '+', color: C.text,
      keywords: ['concat', 'merge', 'append', 'combine'], width: 240,
      inputs: [
        { name: 'Parts', type: 'any', multi: true, hint: 'connect as many inputs as you like' }
      ],
      outputs: [{ name: 'Text', type: 'string' }],
      body: [{ key: 'sep', type: 'text', label: 'Separator', value: ' ', inline: true }],
      compute: function (node, in_) {
        var parts = asList(in_.Parts);
        var out = [];
        for (var i = 0; i < parts.length; i++) out.push(s(parts[i]));
        return { Text: out.join(s(node.body.sep)) };
      }
    },
    {
      type: 'text/format', title: 'Format', category: 'Text', icon: '{}', color: C.text,
      keywords: ['template', 'interpolate', 'placeholder', 'printf'], width: 260,
      inputs: [
        { name: 'A', type: 'any' }, { name: 'B', type: 'any' }, { name: 'C', type: 'any' }
      ],
      outputs: [{ name: 'Text', type: 'string' }],
      body: [{
        key: 'template', type: 'code', rows: 2, value: 'value is {A}',
        placeholder: 'use {A} {B} {C}'
      }],
      compute: function (node, in_) {
        var out = s(node.body.template);
        out = out.replace(/\{([ABC])\}/g, function (m, key) { return fmt(in_[key]); });
        return { Text: out };
      }
    },
    {
      type: 'text/ops', title: 'Text Ops', category: 'Text', icon: 'Aa', color: C.text,
      keywords: ['upper', 'lower', 'length', 'trim', 'reverse', 'replace'], width: 230,
      inputs: [{ name: 'Text', type: 'string' }, { name: 'Search', type: 'string' }, { name: 'Replace', type: 'string' }],
      outputs: [{ name: 'Text', type: 'string' }, { name: 'Length', type: 'number' }],
      body: [{ key: 'op', type: 'select', value: 'upper', options: ['upper', 'lower', 'trim', 'reverse', 'replace', 'length'] }],
      compute: function (node, in_) {
        var t = s(in_.Text);
        var out = t;
        switch (node.body.op) {
          case 'lower': out = t.toLowerCase(); break;
          case 'trim': out = t.trim(); break;
          case 'reverse': out = t.split('').reverse().join(''); break;
          case 'replace': out = t.split(s(in_.Search)).join(s(in_.Replace)); break;
          case 'length': out = t; break;
          default: out = t.toUpperCase();
        }
        return { Text: out, Length: t.length };
      }
    },
    {
      type: 'text/check', title: 'Text Contains', category: 'Text', icon: '?', color: C.text,
      keywords: ['includes', 'startswith', 'endswith', 'match'], width: 230,
      inputs: [{ name: 'Text', type: 'string' }, { name: 'Pattern', type: 'string' }],
      outputs: [{ name: 'Result', type: 'bool' }],
      body: [{ key: 'op', type: 'select', value: 'contains', options: ['contains', 'startsWith', 'endsWith', 'equals'] }],
      compute: function (node, in_) {
        var t = s(in_.Text), p = s(in_.Pattern);
        switch (node.body.op) {
          case 'startsWith': return { Result: t.indexOf(p) === 0 };
          case 'endsWith': return { Result: p.length <= t.length && t.slice(t.length - p.length) === p };
          case 'equals': return { Result: t === p };
          default: return { Result: t.indexOf(p) >= 0 };
        }
      }
    },

    /* ------------------------------------------------------------ list */
    {
      type: 'list/range', title: 'Range', category: 'List', icon: '\u2026', color: C.list,
      keywords: ['sequence', 'numbers', 'loop'], width: 200,
      outputs: [{ name: 'List', type: 'list' }, { name: 'Count', type: 'number' }],
      body: [
        { key: 'start', type: 'number', label: 'Start', value: 1, step: 1 },
        { key: 'stop', type: 'number', label: 'Stop', value: 6, step: 1 },
        { key: 'step', type: 'number', label: 'Step', value: 1, step: 1 }
      ],
      compute: function (node) {
        var start = n(node.body.start), stop = n(node.body.stop);
        var step = n(node.body.step) || 1;
        var out = [];
        if (step > 0) { for (var v = start; v < stop && out.length < 10000; v += step) out.push(v); }
        else { for (var w = start; w > stop && out.length < 10000; w += step) out.push(w); }
        return { List: out, Count: out.length };
      }
    },
    {
      type: 'list/build', title: 'Build List', category: 'List', icon: '\u2630', color: C.list,
      keywords: ['collect', 'gather', 'array', 'append'], width: 220,
      inputs: [{ name: 'Items', type: 'any', multi: true }],
      outputs: [{ name: 'List', type: 'list' }, { name: 'Count', type: 'number' }],
      compute: function (node, in_) {
        var items = asList(in_.Items);
        return { List: items, Count: items.length };
      }
    },
    {
      type: 'list/select', title: 'List Item', category: 'List', icon: '\u2192|', color: C.list,
      keywords: ['index', 'at', 'get', 'first', 'last'], width: 210,
      inputs: [{ name: 'List', type: 'list' }, { name: 'Index', type: 'number', default: 0 }],
      outputs: [{ name: 'Item', type: 'any' }, { name: 'Index', type: 'number' }],
      body: [{ key: 'mode', type: 'select', value: 'index', options: ['index', 'first', 'last'] }],
      compute: function (node, in_) {
        var list = asList(in_.List);
        if (!list.length) return { Item: null, Index: -1 };
        var i = node.body.mode === 'first' ? 0 : (node.body.mode === 'last' ? list.length - 1 : Math.round(n(in_.Index)));
        if (i < 0) i += list.length;
        return { Item: list[i], Index: i };
      }
    },
    {
      type: 'list/aggregate', title: 'Aggregate', category: 'List', icon: '\u03A3', color: C.list,
      keywords: ['sum', 'average', 'min', 'max', 'count', 'product'], width: 210,
      inputs: [{ name: 'List', type: 'list' }],
      outputs: [{ name: 'Result', type: 'number' }],
      body: [{ key: 'op', type: 'select', value: 'sum', options: ['sum', 'product', 'average', 'min', 'max', 'count'] }],
      compute: function (node, in_) {
        var list = asList(in_.List), nums = [], i;
        for (i = 0; i < list.length; i++) nums.push(n(list[i]));
        if (!nums.length) return { Result: 0 };
        switch (node.body.op) {
          case 'product': return { Result: nums.reduce(function (a, c) { return a * c; }, 1) };
          case 'average': return { Result: nums.reduce(function (a, c) { return a + c; }, 0) / nums.length };
          case 'min': return { Result: Math.min.apply(null, nums) };
          case 'max': return { Result: Math.max.apply(null, nums) };
          case 'count': return { Result: nums.length };
          default: return { Result: nums.reduce(function (a, c) { return a + c; }, 0) };
        }
      }
    },
    {
      type: 'list/transform', title: 'Transform List', category: 'List', icon: '\u21BB', color: C.list,
      keywords: ['map', 'filter', 'sort', 'reverse', 'unique'], width: 250,
      inputs: [{ name: 'List', type: 'list' }],
      outputs: [{ name: 'List', type: 'list' }, { name: 'Count', type: 'number' }],
      body: [
        { key: 'op', type: 'select', value: 'map', options: ['map', 'filter', 'sort', 'reverse', 'unique'] },
        { key: 'expr', type: 'code', rows: 2, value: 'item * 2', placeholder: 'item, index' }
      ],
      compute: function (node, in_) {
        var list = asList(in_.List), out = [], i;
        var op = node.body.op;
        if (op === 'map') {
          for (i = 0; i < list.length; i++) out.push(evalExpression(node.body.expr, { item: list[i], index: i }));
        } else if (op === 'filter') {
          for (i = 0; i < list.length; i++) if (n(evalExpression(node.body.expr, { item: list[i], index: i })) !== 0) out.push(list[i]);
        } else if (op === 'sort') {
          out = list.slice().sort(function (x, y) {
            var a = n(x), c = n(y);
            return a === c ? String(x) < String(y) ? -1 : 1 : a - c;
          });
        } else if (op === 'reverse') {
          out = list.slice().reverse();
        } else {
          var seen = {};
          for (i = 0; i < list.length; i++) {
            var k = s(list[i]);
            if (!seen[k]) { seen[k] = 1; out.push(list[i]); }
          }
        }
        return { List: out, Count: out.length };
      }
    },
    {
      type: 'list/split', title: 'Split Text', category: 'List', icon: '\u2702', color: C.list,
      keywords: ['explode', 'tokenize', 'csv', 'lines'], width: 220,
      inputs: [{ name: 'Text', type: 'string' }],
      outputs: [{ name: 'List', type: 'list' }, { name: 'Count', type: 'number' }],
      body: [{ key: 'sep', type: 'text', label: 'Separator', value: ',', inline: true }],
      compute: function (node, in_) {
        var sep = s(node.body.sep);
        var text = s(in_.Text);
        var parts = sep === '' ? text.split('') : text.split(sep);
        if (parts.length === 1 && parts[0] === '' && !text) parts = [];
        return { List: parts, Count: parts.length };
      }
    },

    /* ------------------------------------------------------- utility */
    {
      type: 'util/timestamp', title: 'Timestamp', category: 'Utility', icon: '\u23F1', color: C.util,
      keywords: ['date', 'time', 'now', 'clock'], width: 240,
      outputs: [{ name: 'Text', type: 'string' }, { name: 'Millis', type: 'number' }],
      preview: true,
      compute: function () {
        var d = new Date();
        var pad = function (v) { return v < 10 ? '0' + v : String(v); };
        return {
          Text: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()),
          Millis: d.getTime()
        };
      }
    },
    {
      type: 'util/counter', title: 'Counter', category: 'Utility', icon: '\u21BB', color: C.util,
      keywords: ['increment', 'tick', 'step'], width: 200,
      inputs: [{ name: 'Reset', type: 'bool', default: false }, { name: 'Step', type: 'number', default: 1 }],
      outputs: [{ name: 'Value', type: 'number' }],
      preview: true,
      /** a definition may ask the host for per-node scratch state */
      createState: function () { return { value: 0 }; },
      compute: function (node, in_, state) {
        if (b(in_.Reset)) state.value = 0;
        else state.value += n(in_.Step);
        return { Value: state.value };
      }
    },

    /* -------------------------------------------------------- output */
    {
      type: 'output/preview', title: 'Preview', category: 'Output', icon: '\u25C9', color: C.output,
      keywords: ['show', 'display', 'view', 'debug', 'result'], width: 240, preview: true,
      terminal: true,
      inputs: [{ name: 'Value', type: 'any' }],
      compute: function (node, in_) {
        var v = in_.Value;
        var text;
        if (isList(v)) text = '[' + v.length + '] ' + v.map(s).join(', ');
        else if (v === null || v === undefined) text = '\u2014';
        else text = s(v);
        if (text.length > 400) text = text.slice(0, 400) + '\u2026';
        return { value: text };
      }
    },
    {
      type: 'output/chart', title: 'Bar Chart', category: 'Output', icon: '\u2587', color: C.output,
      keywords: ['graph', 'plot', 'visualise', 'histogram'], width: 260,
      terminal: true,
      inputs: [{ name: 'List', type: 'list' }],
      /** a definition can draw its own body instead of using widgets */
      render: function (node, api) {
        var box = document.createElement('div');
        box.className = 'ng-preview';
        var canvas = document.createElement('canvas');
        canvas.className = 'ng-chart';
        canvas.width = 240;
        canvas.height = 64;
        box.appendChild(canvas);
        node._chartCanvas = canvas;
        api.node._chartRedraw = function (values) {
          var ctx = canvas.getContext && canvas.getContext('2d');
          if (!ctx) return;
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#171717';
          ctx.fillRect(0, 0, w, h);
          var nums = [], i;
          for (i = 0; i < (values || []).length; i++) {
            var v = parseFloat(values[i]);
            nums.push(isFinite(v) ? v : 0);
          }
          if (!nums.length) return;
          var max = Math.max.apply(null, nums);
          var min = Math.min.apply(null, nums);
          var span = (max - min) || 1;
          var bw = w / nums.length;
          for (i = 0; i < nums.length; i++) {
            var bh = Math.max(1, ((nums[i] - min) / span) * (h - 6));
            ctx.fillStyle = '#7fc8e8';
            ctx.fillRect(i * bw + 1, h - bh - 2, Math.max(1, bw - 2), bh);
          }
        };
        return box;
      },
      compute: function (node, in_) {
        var list = asList(in_.List), nums = [], i;
        for (i = 0; i < list.length; i++) nums.push(n(list[i]));
        if (node._chartRedraw) node._chartRedraw(nums);
        var max = nums.length ? Math.max.apply(null, nums) : 0;
        return { value: nums.length + ' values, max ' + max };
      }
    },
    {
      type: 'output/text-file', title: 'Text Block', category: 'Output', icon: '\u2263', color: C.output,
      keywords: ['file', 'export', 'write', 'dump', 'report'], width: 260,
      terminal: true,
      inputs: [{ name: 'Text', type: 'string' }, { name: 'Path', type: 'string', default: 'output.txt' }],
      compute: function (node, in_) {
        return { value: 'would write ' + s(in_.Path) + '\n---\n' + s(in_.Text) };
      }
    }
  ];

  return {
    exampleNodes: nodes,
    colors: C,
    util: { evalExpression: evalExpression, num: n, str: s, bool: b }
  };
});
