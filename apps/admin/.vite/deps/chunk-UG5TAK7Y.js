import {
  getConfig2
} from "./chunk-XXSDIRFV.js";
import {
  select_default
} from "./chunk-J3KGVFTI.js";
import {
  __name
} from "./chunk-HHMJ4QX7.js";

// ../../node_modules/mermaid/dist/chunks/mermaid.core/chunk-CLGD4ZFX.mjs
var selectSvgElement = __name((id) => {
  var _a;
  const { securityLevel } = getConfig2();
  let root = select_default("body");
  if (securityLevel === "sandbox") {
    const sandboxElement = select_default(`#i${id}`);
    const doc = ((_a = sandboxElement.node()) == null ? void 0 : _a.contentDocument) ?? document;
    root = select_default(doc.body);
  }
  const svg = root.select(`#${id}`);
  return svg;
}, "selectSvgElement");

export {
  selectSvgElement
};
//# sourceMappingURL=chunk-UG5TAK7Y.js.map
