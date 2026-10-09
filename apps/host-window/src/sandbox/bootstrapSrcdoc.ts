/**
 * Trusted first-party bootstrap HTML for sandboxed custom packages.
 * Runs with sandbox="allow-scripts" only (opaque unique origin; same-origin flag MUST stay off).
 */
import { IUI_SANDBOX_CHANNEL } from "./protocol";

/** CSP: no network, no parent navigation; scripts only inline + blob modules. */
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

export function buildSandboxSrcdoc(): string {
  const boot = `
(function () {
  var CHANNEL = ${JSON.stringify(IUI_SANDBOX_CHANNEL)};
  var rootEl = document.getElementById('root');
  var statusEl = document.getElementById('status');
  var reactRoot = null;
  var Comp = null;
  var currentRequestId = null;
  var currentNodeId = null;
  var currentComponentType = null;

  function post(msg) {
    msg.channel = CHANNEL;
    parent.postMessage(msg, '*');
  }

  function setStatus(text, isErr) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.style.display = text ? 'block' : 'none';
    statusEl.style.color = isErr ? '#b91c1c' : '#64748b';
  }

  function runUmd(source, label) {
    var s = document.createElement('script');
    s.textContent = source;
    s.setAttribute('data-iui-vendor', label);
    document.head.appendChild(s);
  }

  function makeReactShim() {
    var R = globalThis.React;
    if (!R) throw new Error('React UMD did not install globalThis.React');
    var named = Object.keys(R).filter(function (k) {
      return k !== 'default' && /^[A-Za-z_$][\\w$]*$/.test(k);
    });
    var body = 'const R = globalThis.React;\\nexport default R;\\n' +
      named.map(function (k) { return 'export const ' + k + ' = R.' + k + ';'; }).join('\\n');
    return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
  }

  function makeReactDomShim() {
    var RD = globalThis.ReactDOM;
    if (!RD) throw new Error('ReactDOM UMD did not install globalThis.ReactDOM');
    var named = Object.keys(RD).filter(function (k) {
      return k !== 'default' && /^[A-Za-z_$][\\w$]*$/.test(k);
    });
    var body = 'const RD = globalThis.ReactDOM;\\nexport default RD;\\n' +
      named.map(function (k) { return 'export const ' + k + ' = RD.' + k + ';'; }).join('\\n') +
      '\\nexport const createRoot = (RD.createRoot ? RD.createRoot.bind(RD) : undefined);';
    return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
  }

  function makeJsxRuntimeShim() {
    var body = [
      'import React from "react";',
      'export const Fragment = React.Fragment;',
      'export function jsx(type, props, key) {',
      '  var p = props || {};',
      '  var children = p.children;',
      '  var rest = Object.assign({}, p); delete rest.children;',
      '  if (key !== undefined && key !== null) rest.key = key;',
      '  return children !== undefined ? React.createElement(type, rest, children) : React.createElement(type, rest);',
      '}',
      'export const jsxs = jsx;',
      'export const jsxDEV = jsx;',
    ].join('\\n');
    return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
  }

  function installImportMap() {
    var map = {
      imports: {
        react: makeReactShim(),
        'react/jsx-runtime': makeJsxRuntimeShim(),
        'react/jsx-dev-runtime': makeJsxRuntimeShim(),
        'react-dom': makeReactDomShim(),
        'react-dom/client': makeReactDomShim(),
      },
    };
    var el = document.createElement('script');
    el.type = 'importmap';
    el.textContent = JSON.stringify(map);
    document.head.appendChild(el);
  }

  function flattenAction(a) {
    a = a || {};
    // If component passed a full RenderAction, keep fields; unwrap one nested .action.
    if (a.action && typeof a.action === 'object' && (a.action.type || a.type)) {
      var inner = a.action;
      return {
        type: inner.type || a.type,
        value: ('value' in inner) ? inner.value : a.value,
        path: inner.path || a.path,
        payload: inner.payload || a.payload || {},
        actionId: a.actionId || inner.actionId,
      };
    }
    return {
      type: a.type,
      value: a.value,
      path: a.path,
      payload: a.payload || {},
      actionId: a.actionId,
    };
  }

  function renderWithProps(props) {
    if (!Comp || !rootEl || !globalThis.React || !globalThis.ReactDOM) return;
    var React = globalThis.React;
    var ReactDOM = globalThis.ReactDOM;
    var onAction = function (a) {
      var flat = flattenAction(a);
      var msg = {
        type: 'action',
        requestId: currentRequestId,
        nodeId: currentNodeId,
        componentType: currentComponentType,
        action: {
          type: flat.type,
          value: flat.value,
          path: flat.path,
          payload: flat.payload || {},
        },
      };
      if (flat.actionId) msg.actionId = flat.actionId;
      post(msg);
    };
    var element = React.createElement(Comp, Object.assign({}, props || {}, {
      nodeId: currentNodeId,
      onAction: onAction,
    }));
    if (!reactRoot) {
      if (ReactDOM.createRoot) {
        reactRoot = ReactDOM.createRoot(rootEl);
        reactRoot.render(element);
      } else {
        ReactDOM.render(element, rootEl);
      }
    } else {
      reactRoot.render(element);
    }
    requestAnimationFrame(function () {
      var h = Math.max(
        document.documentElement.scrollHeight || 0,
        document.body.scrollHeight || 0,
        rootEl.scrollHeight || 0,
        48,
      );
      post({ type: 'resize', requestId: currentRequestId, height: h });
    });
  }

  async function handleInit(msg) {
    currentRequestId = msg.requestId;
    currentNodeId = msg.nodeId;
    currentComponentType = msg.componentType;
    setStatus('loading…', false);
    try {
      if (!globalThis.React) runUmd(msg.reactUmd, 'react');
      if (!globalThis.ReactDOM) runUmd(msg.reactDomUmd, 'react-dom');
      if (!document.querySelector('script[type="importmap"]')) installImportMap();

      var modUrl = URL.createObjectURL(
        new Blob([msg.moduleSource], { type: 'text/javascript' }),
      );
      var mod = await import(modUrl);
      URL.revokeObjectURL(modUrl);
      var exportName = msg.exportName || 'default';
      Comp =
        mod[exportName] ||
        (mod.default && mod.default[exportName]) ||
        (exportName === 'default' ? mod.default : null);
      if (!Comp) {
        throw new Error('missing export: ' + exportName);
      }
      renderWithProps(msg.props || {});
      setStatus('', false);
      post({ type: 'ready', requestId: msg.requestId });
    } catch (e) {
      var message = e && e.message ? e.message : String(e);
      setStatus(message, true);
      post({ type: 'error', requestId: msg.requestId, message: message });
    }
  }

  function handleProps(msg) {
    currentRequestId = msg.requestId || currentRequestId;
    currentNodeId = msg.nodeId || currentNodeId;
    renderWithProps(msg.props || {});
  }

  function handleDispose() {
    try {
      if (reactRoot && reactRoot.unmount) reactRoot.unmount();
      else if (rootEl) rootEl.innerHTML = '';
    } catch (_) { /* ignore */ }
    reactRoot = null;
    Comp = null;
  }

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || data.channel !== CHANNEL) return;
    if (ev.source !== parent) return;
    if (data.type === 'init') handleInit(data);
    else if (data.type === 'props') handleProps(data);
    else if (data.type === 'dispose') handleDispose();
    else if (data.type === 'action_ack') {
      // Parent confirmed Host POST /api/action; keep for debugging / future UI.
      try {
        rootEl && rootEl.setAttribute('data-iui-last-ack', String(data.actionId || ''));
        rootEl && rootEl.setAttribute('data-iui-last-ack-ok', data.ok ? '1' : '0');
      } catch (_) { /* ignore */ }
    }
  });

  post({ type: 'boot' });
})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="${CSP}"/>
<title>iui-sandbox</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; font: 14px/1.4 system-ui, sans-serif; color: #0f172a; }
  #root { padding: 4px; }
  #status { display: none; padding: 8px; font-size: 12px; }
</style>
</head>
<body>
<div id="status"></div>
<div id="root"></div>
<script>${boot}</script>
</body>
</html>`;
}
