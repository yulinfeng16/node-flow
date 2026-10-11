# node-flow

A portable, dependency-free editor for **Blender-style node graphs**.

**Scope (important):** this library is *only* the interface and the connection
data. It ships **no built-in node types and no execution engine**. You define
every node yourself (title, sockets, parameter widgets, colour) and you decide
what the wired-up graph means. Evaluate it, compile it, send it to a server,
turn it into geometry, whatever you like. The 32 nodes under `examples/` are
sample content for the demo.

```
core.js   graph model: nodes, sockets, links, serialisation, undo, connection-data API
ui.js     the editor: pan/zoom, drag, wire, box-select, menus, widgets, undo UI
```

Both files are plain ES5-compatible UMD scripts. Works from `file://`, inside
Electron/webview shells, and in Node (for tests).

---

## Quick start

```html
<div id="graph" style="position:absolute;inset:0"></div>

<script src="core.js"></script>
<script src="ui.js"></script>
<script>
  // 1. describe YOUR node types
  var registry = new NG.NodeRegistry();
  registry.register([
    {
      type: 'my/number', title: 'Number', category: 'Mine', color: '#3c6e52', icon: '#',
      outputs: [{ name: 'Value', type: 'number' }],
      body: [{ key: 'value', type: 'number', label: 'Value', value: 5 }]
    },
    {
      type: 'my/double', title: 'Double', category: 'Mine', color: '#3a5a7a',
      inputs: [{ name: 'In', type: 'number' }],
      outputs: [{ name: 'Out', type: 'number' }]
    }
  ]);

  // 2. create the editor
  var graph  = new NG.Graph({ registry: registry });
  var editor = new NGEditor('#graph', { registry: registry, graph: graph, globalKeys: true });

  // 3. work with the result
  graph.on('change', function () {
    var saved = graph.serialize();   // <- save this, it is the whole document
    var wired = graph.toData();      // <- resolved "who feeds whom" for your code
    console.log(wired.links);
  });
</script>
```

Open [`examples/minimal.html`](examples/minimal.html) for the smallest complete
page, or [`examples/app.html`](examples/app.html) for the full demo.

---

## The document (what you save and load)

```js
var doc = editor.serialize();      // includes the view transform
editor.load(doc);                  // restores it
JSON.stringify(doc, null, 2);
```

```json
{
  "format": "node-flow/graph",
  "version": 1,
  "generator": "node-flow 1.0.0",
  "meta": { "name": "Untitled graph" },
  "view": { "x": 40, "y": 40, "zoom": 1 },
  "nodes": [
    {
      "id": "n_2_xk91", "type": "my/number", "title": "Number",
      "x": 40, "y": 60, "w": 180, "h": 0,
      "collapsed": false, "muted": false, "locked": false, "comment": "",
      "body":   { "value": 5 },
      "custom": {},
      "inputs":  [],
      "outputs": [ { "id": "s_1_p0a", "name": "Value", "type": "number", "multi": false, "hint": "" } ]
    }
  ],
  "edges": [
    { "id": "e_7_bb1", "from": "n_2_xk91", "fromSocket": "s_1_p0a",
      "to": "n_9_zz2", "toSocket": "s_4_mm3", "type": "number" }
  ]
}
```

* Every **link always runs output → input** (`fromSocket` is on `from`,
  `toSocket` is on `to`).
* Socket ids are stable: they are preserved across save/load, copy/paste, undo
  and dynamic port rebuilds, so links never dangle.
* Node `body` holds all parameter values. `custom` is a free-form bag for your
  own data (tags, generated code, asset ids …) that round-trips untouched.
* Unknown node types are preserved as inert placeholder nodes rather than
  dropped, so a document made with a newer node set still opens.

### Reading the connections in your code

```js
graph.toData()          // { meta, nodes:[...], links:[{ from:{node,socket,name,dataType}, to:{...} }] }
graph.inspect(nodeId)   // one node with resolved links per socket
graph.inEdges(nodeId, socketId)   // links arriving at a socket
graph.outEdges(nodeId, socketId)  // links leaving a socket
graph.topoOrder()                 // execution order, or null when there is a cycle
graph.wouldCycle(fromNodeId, toNodeId)
graph.upstream(id) / graph.downstream(id)
graph.stats()
```

```js
graph.toData().links.forEach(function (link) {
  console.log(link.from.name + ' -> ' + link.to.name, link.from.dataType);
});
```

Example host code that walks this data and evaluates a graph lives in
[`examples/host.js`](examples/host.js) — again, *not* part of the library.

---

## Defining your own nodes

`NodeRegistry#register(def)` accepts one definition or an array. Only `type` is
required.

| field | meaning |
| --- | --- |
| `type` | unique id, e.g. `'my/image-filter'` |
| `title` | header caption |
| `category` | grouping in the add menu / search palette |
| `keywords` | extra search terms |
| `icon` | short glyph or emoji in the header |
| `color` | header colour (`headerColor` also accepted) |
| `dotColor` | the little square in the header |
| `description` | help text (tooltip) |
| `width` | preferred width in graph units |
| `inputs` / `outputs` | socket specs, see below |
| `body` | parameter widgets rendered inside the node |
| `preview` | `true` reserves a live-preview area (host fills `node.state.preview`) |
| `terminal` | your own marker — the library never reads it (the demo uses it for output nodes) |
| `init(node)` | runs right after the node is created |
| `computePorts(node, ports)` | dynamic sockets |
| `render(node, api)` | fully custom body DOM |
| `onBodyChange(node, key, value, api)` | react to a widget edit |

**Socket spec:** `{ id?, name, type, multi?, default?, hint?, accept?, widget? }`
`multi: true` makes an input accept many wires (the host receives an array).
`accept: ['string','any']` overrides the type compatibility rule for that port.

**Widget spec:** `{ key, type, label?, value?, ...options }` where `type` is one
of `number`, `int`, `range`, `text`, `textarea`, `code`, `select`, `check`,
`vector`, `color`, `button`, `note`. Values are read/written at `node.body[key]`.

```js
registry.register({
  type: 'my/scale', title: 'Scale', category: 'Transform', color: '#3a5a7a', icon: '\u26F6',
  inputs:  [{ name: 'Vector', type: 'vector' }, { name: 'Factor', type: 'number', default: 1 }],
  outputs: [{ name: 'Vector', type: 'vector' }],
  body: [
    { key: 'axis', type: 'select', label: 'Axis', value: 'xyz', options: ['xyz', 'x', 'y', 'z'] },
    { key: 'lock', type: 'check', label: 'Lock proportions', value: true }
  ]
});
```

### Widgets added at runtime

```js
NGEditor.Widgets.renderers.mydate = function (node, field) {
  var wrap = NGEditor.el('div', 'ng-field');
  var input = NGEditor.el('input', 'ng-input');
  input.type = 'date';
  input.value = node.body[field.key] || '';
  wrap.__value = input;
  wrap.appendChild(input);
  return wrap;
};
NGEditor.Widgets.readers.mydate = function (widget) { return widget.__value.value; };
```

### Dynamic ports

```js
registry.register({
  type: 'my/switch-case', title: 'Switch', category: 'Logic',
  inputs: [{ name: 'Value', type: 'any' }],
  outputs: [{ name: 'Hit', type: 'bool' }],
  body: [{ key: 'cases', type: 'int', label: 'Cases', value: 2, min: 1, max: 8 }],
  // called on every edit and every render; return the full port list
  computePorts: function (node) {
    var n = Math.max(1, Math.min(8, Number(node.body.cases) || 1));
    var inputs = [{ name: 'Value', type: 'any' }];
    for (var i = 0; i < n; i++) inputs.push({ name: 'Match ' + (i + 1), type: 'any' });
    return { inputs: inputs, outputs: [{ name: 'Hit', type: 'bool' }] };
  }
});
```

Sockets whose **name** survives are reused with their original id, so existing
wires are kept; ports that disappear take their wires with them.

### Custom body rendering

```js
registry.register({
  type: 'my/chart', title: 'Chart', category: 'Output', width: 260,
  inputs: [{ name: 'List', type: 'list' }],
  render: function (node, api) {
    var canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 64;
    node.draw = function (values) { /* … */ };
    api.refresh();          // ask the editor to repaint
    return canvas;          // inserted into the node body
  }
});
```

### Socket types

Built in: `any`, `number`, `int`, `bool`, `string`, `vector`, `color`, `list`,
`object`, `geometry`, `exec` — each with a colour and a coercion rule.

```js
NG.SocketTypes.define('image', {
  color: '#c060d0',
  accepts: ['image', 'any', 'string'],   // what may connect into it
  coerce: function (value) { return { kind: 'image', src: String(value) }; }
});
NG.socketAccepts(socket, 'string');      // -> true
NG.typesCompatible('number', 'string');  // -> true
NG.coerce(value, 'number', 'string');    // -> "42"
```

---

## Editor API

```js
var editor = new NGEditor(hostElementOrSelector, {
  registry: registry,              // required unless you pass it via the graph
  graph: graph,                    // reuse an existing document
  readOnly: false,                 // no editing, selection only
  snap: true, grid: 16,            // 16px snapping (hold Ctrl to bypass)
  minZoom: 0.15, maxZoom: 2.5,
  globalKeys: false,               // true = shortcuts work without focus
  showGrid: true,
  rightDragPan: true,              // right-drag on empty canvas pans; a right
                                   // *click* still opens the context menu
  pinchZoom: true,                 // two fingers pinch to zoom / drag to pan
  longPressMenu: true,             // press and hold opens the context menu
  longPressDelay: 500, longPressTolerance: 10,
  dragNodeBody: true,              // grab anywhere on a node to move it
                                   // (widgets still receive their own drags)
  buildContextMenu: function (node, editor) { return [{ label: '…', action: fn }]; }
});
```

| method | purpose |
| --- | --- |
| `addNode(typeOrDef, {x,y})` | create a node (returns it) |
| `addNodeAtCenter(type)` | create a node in the middle of the view |
| `deleteSelection()` / `copy()` / `paste(at)` / `duplicate()` | clipboard & editing |
| `select(id, add)` / `deselect(id)` / `selectAll()` / `clearSelection()` / `getSelection()` | selection |
| `frameAll(padding?)` / `frameNode(node)` | fit the view |
| `setView({x,y}, zoom)` / `zoomAt(lx, ly, factor)` / `zoomBy(f)` | view transform |
| `serialize()` / `toJSON(pretty?)` / `load(doc)` | persistence |
| `refresh()` | rebuild the DOM after an external model change |
| `openSearch(clientX, clientY, opts?)` / `openCanvasMenu(x, y)` / `openNodeMenu(x, y, node)` | menus |
| `setNodeState(node, { running, error, preview })` | host feedback shown on the node |
| `syncWidgets(node)` | push `node.body` back into the widgets |
| `resize()` / `destroy()` | lifecycle |

Events: `editor.on(name, fn)` and `editor.emit(name)`.

| event | when |
| --- | --- |
| `view` | pan/zoom changed |
| `selection` | selection changed |
| `node:added`, `nodes:moved`, `node:resized`, `node:change` | direct edits |
| `history`, `refresh`, `clipboard` | undo stack / reload / clipboard |
| `request:search`, `request:toggle-panel` | `Tab` and `N` key intents |

Graph events (`graph.on(name, fn)`): `change`, `node:add`, `node:remove`,
`node:move`, `node:ports`, `edge:add`, `edge:remove`, `nodes:clone`, `load`,
`clear`, `history`.

### Host-driven feedback

```js
graph.nodesOfType('my/show').forEach(function (node) {
  editor.setNodeState(node, { preview: 'value = 42' });   // fills the preview area
  editor.setNodeState(node, { error: 'file not found' }); // red border + message
  editor.setNodeState(node, { running: true });           // animated header
});
```

---

## Interactions

| input | action |
| --- | --- |
| Right-click / double-click canvas | add-node menu / fuzzy search |
| `Tab` | search palette (type, ↑↓, Enter) |
| Drag output → input | connect (invalid sockets are refused, compatibility is enforced) |
| Drag from a linked input | detach that wire and keep dragging it |
| Drag input → output | also works (both directions) |
| Drop a wire on empty canvas | search palette filtered to nodes that fit, auto-wires on pick |
| Alt+click or double-click a wire | cut it |
| Click a wire, then `Del` | delete it |
| Left-drag on empty canvas | box select (`Shift` adds) |
| Left-drag a node (header **or** body) | move (`Shift`/`Ctrl` multi-select, `Alt` drag = copy) |
| Drag inside a parameter widget | edits the value, never moves the node |
| Drag node corner | resize |
| Middle-drag (anywhere) / `Space`+drag / `Alt`+drag | pan |
| **Right-drag on empty canvas** | pan (a right *click* still opens the menu) |
| Wheel | zoom on the cursor |
| `H` | frame all |
| `F` / `M` | collapse / mute selection |
| `Ctrl+A/C/V/X/D`, `Ctrl+Z/Y` | select all, clipboard, duplicate, undo/redo |
| `Del` | delete selection |
| `N` | emit `request:toggle-panel` (host side panel) |
| **One finger drag** | move the node you grabbed / draw a wire / box select |
| **Two fingers pinch** | zoom (no wheel needed) |
| **Two fingers drag** | pan |
| **Long press (500 ms)** | context menu — the touch replacement for right-click |

Undo covers node creation/deletion, moves, resizes, wiring, widget edits,
collapse, mute, paste and load. Every gesture is one undo step.

### Touch

Touch needs no configuration; the editor switches to a finger-friendly layout on
the first finger it sees (or immediately on a `(pointer: coarse)` device):

* sockets grow from 13px to **24px**, the header to 32px and the port rows to
  30px, and widgets get taller. The dot keeps its centre on the node border, so
  wire endpoints stay exact — `test/touch.test.js` asserts the drawn wire lands
  within 0.75px of the socket centre in touch mode, also after pan+zoom.
* **A wire can be started from either side.** The socket you grab stays the
  *origin* and the direction is decided when you let go, so "drag from the input
  across the node to the output" works — that matters on touch, where a node's
  inputs and outputs are far apart.
* **A second finger always wins:** if it lands while you are dragging a node or
  pulling a wire, that half-finished gesture is rolled back and the pinch takes
  over (`ng-touch` `_cancelGesture`), so zooming never leaves a node somewhere
  you did not put it.
* Rejected drops flash the socket, so a failed connection is visible.
* Options: `pinchZoom` (default `true`), `longPressMenu` (default `true`),
  `longPressDelay` (500), `longPressTolerance` (10). The event `gesture` fires
  when a pinch starts — hosts can use it to abort their own pending action.

A long press that moves more than `longPressTolerance` is treated as a drag and
will not open a menu.

### Wires and folding

Wire endpoints are taken from the node's **measured** layout, not from
hard-coded arithmetic: after every DOM rebuild the editor reads the first row's
centre, the row pitch and the socket offsets (in graph units) into
`rec.layout`, and `Editor#portAnchor` resolves a socket from those numbers.

* Rows are `24px` with no row gap, and there is no gap between the port rows
  and the widgets, so a socket is exactly one row-pitch away from its neighbour.
* Input rows and output rows are two separate stacks. A node with 2 inputs and
  1 output draws `in, in, out`, not a 3-row grid.
* **Collapsed nodes keep their rows in the DOM** (class `ng-collapsedrows`,
  body visible but hidden and zero-height) so the geometry stays measurable.
  While folded, both endpoints are pinned to the node's bar: the middle of the
  header vertically, its border horizontally — so folding and unfolding a node
  never lets its wires float away.
* Engines without a layout pass report zero-sized boxes; the editor detects
  that and falls back to the documented constants
  (`header 26 + padding 6 + row/2`, `row = 24`, socket offsets `0` / `+6.5`).

If you restyle the node body, override `Editor#portAnchor` or keep the layout
rules above — the browser test `test/browser.test.js` (§10) asserts that both
endpoints of a drawn wire land within 0.75px of the real socket centres, in
both the expanded and the collapsed state.

---

## Demo

```
examples/app.html          full demo: toolbar, results panel, log, examples, save/load
examples/minimal.html      ~60 lines: register 3 nodes, create the editor, read the data
examples/nodes-example.js  32 example node definitions + a tiny expression parser
examples/host.js           example host evaluator (walks graph.toData() and computes)
```

Open `examples/app.html` directly in a browser — no server needed. It also
contains sample graphs (tip calculator, FizzBuzz, text statistics), saves to
`localStorage` and can download/load JSON documents.

**What the demo's host does** (this is the part you would replace): it evaluates
the graph in topological order, feeds each connected value into every node's
`compute`, writes the results back into the nodes as inline previews
(`editor.setNodeState`), and lists terminal values in the side panel. Because
the library only hands over *node + connection data*, an equally valid host
would compile the same document to JavaScript, to shader code or to SQL.

## Tests

```
node test/run.js              # every suite: 5 suites, 292 assertions
node test/test.js             # model + editor behaviour (136)          - jsdom
node test/examples.test.js    # example nodes, expression parser, host evaluator (33)
node test/smoke.test.js       # loads examples/*.html for real (40)     - jsdom
node test/browser.test.js     # real Chrome via CDP: focus, drag, pan, wires (47)
node test/touch.test.js       # real Chrome touch: pinch, pan, long press, wires (36)
```

* `test.js` drives the actual UI: mounts the editor, drags sockets, box-selects,
  edits widgets, reloads documents, undoes and redoes.
* `examples.test.js` checks the sample node set and the host-side evaluator,
  including cycle detection, multi-inputs and per-node errors.
* `smoke.test.js` boots `examples/minimal.html` and `examples/app.html` in jsdom
  with scripts enabled, so a broken script tag or a typo in the demo fails here
  instead of in the browser. It also verifies save → reload round-trips.
* `browser.test.js` launches headless Chrome and drives **real** mouse and
  keyboard input over the DevTools protocol, because jsdom cannot model focus or
  `tagName` casing faithfully — the widget-focus and node-drag behaviour is only
  trustworthy in a real engine. Skipped automatically when no Chromium is found.
* `touch.test.js` does the same with **real touch events** (device emulation):
  pinch zoom anchored on the pinch centre, two-finger pan, one-finger drag,
  long-press menus, wire dragging from either side, and the wire-endpoint
  geometry while the finger-sized layout is active.

`jsdom` is the only dev dependency (`npm install`); the library itself has none.

## Portability notes

* UMD: `window.NG` / `window.NGEditor` in a browser, `require('./core.js')` in Node.
* No `eval`, no `new Function`, no `innerHTML` for user data, no external assets.
* Node text and coordinates are stored in graph space; the view transform is
  applied through a single `transform` on the node layer, and wires are drawn on
  a canvas in screen space so lines stay crisp at any zoom.
* Socket anchor positions are computed analytically from the node layout
  (documented in `Editor#portAnchor`), so they are stable even before layout
  settles — override that method if you restyle the node body.
* `prefers-reduced-motion` is respected implicitly (the only animation is the
  "running" header stripe).

## License

MIT. `examples/` is sample code demonstrating how a host application drives the
library; only `core.js` and `ui.js` are the library.
