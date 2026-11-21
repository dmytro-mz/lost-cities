// Tiny DOM helpers: element builders (HTML + SVG), toasts, dialogs, clipboard.

// Handlers go through one dispatcher per event type, so `morph` can swap them without rebinding.
function listen(el, type, fn) {
  el._on ||= {};
  if (!(type in el._on)) el.addEventListener(type, (e) => el._on[type]?.(e));
  el._on[type] = fn;
}

function build(el, attrs, children) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key.startsWith("on") && typeof value === "function") listen(el, key.slice(2), value);
    else if (key === "value") el.value = value;
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function h(tag, attrs = {}, ...children) {
  return build(document.createElement(tag), attrs, children);
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, ...children) {
  return build(document.createElementNS(SVG_NS, tag), attrs, children);
}

// ------------------------------------------------------------------ morph
// Patch `parent`'s children to match `next` (freshly built nodes) while keeping the existing elements
// wherever they still fit: only changed attributes, texts and handlers are touched, so focus, scroll,
// running transitions and form controls survive a re-render. Children match by data-key or id, else in order.
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute("data-key") || n.id || null : null);

function sameKind(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
}

function patchNode(old, next) {
  if (old.nodeType !== 1) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return;
  }
  for (const { name } of [...old.attributes]) if (!next.hasAttribute(name)) old.removeAttribute(name);
  for (const { name, value } of next.attributes) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  const handlers = { ...(old._on || {}) };
  for (const type in handlers) old._on[type] = undefined;
  for (const [type, fn] of Object.entries(next._on || {})) listen(old, type, fn);
  morph(old, [...next.childNodes]);
  if (old.tagName === "INPUT") {
    old.checked = next.checked;
    if (old.value !== next.value && document.activeElement !== old) old.value = next.value;
  } else if (old.tagName === "SELECT") old.value = next.value;
  else if (old.tagName === "OPTION") old.selected = next.selected;
}

export function morph(parent, next) {
  next = [next]
    .flat(Infinity)
    .filter((n) => n !== null && n !== undefined && n !== false)
    .map((n) => (n instanceof Node ? n : document.createTextNode(String(n))));
  const keyed = new Map();
  const loose = [];
  for (const child of parent.childNodes) {
    const key = keyOf(child);
    if (key) keyed.set(key, child);
    else loose.push(child);
  }
  let li = 0;
  next.forEach((n, i) => {
    const key = keyOf(n);
    let old = key ? keyed.get(key) : loose[li];
    if (key) keyed.delete(key);
    else if (old && sameKind(old, n)) li++;
    else old = null;
    let node = n;
    if (old && sameKind(old, n)) {
      patchNode(old, n);
      node = old;
    }
    const at = parent.childNodes[i];
    if (at !== node) parent.insertBefore(node, at || null);
  });
  while (parent.childNodes.length > next.length) parent.lastChild.remove();
}

export function toast(message, error = false) {
  const box = document.getElementById("toasts");
  const el = h("div", { class: `toast${error ? " err" : ""}` }, message);
  box.append(el);
  setTimeout(() => el.remove(), 3200);
}

// A modal dialog on top of everything. Returns a function that closes it.
export function openDialog(content, { dismissable = true, onClose } = {}) {
  const backdrop = h("div", { class: "backdrop" }, content);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape" && dismissable) close();
  };
  if (dismissable) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
  }
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  const focus = content.querySelector("input, button.primary");
  focus?.focus();
  return close;
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  // Plain-http LAN addresses are not a secure context, so the async clipboard API is missing.
  const area = h("textarea", { style: { position: "fixed", opacity: "0", top: "0" } });
  area.value = text;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
