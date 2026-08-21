import {
  parse
} from "./chunk-HGOOIHEW.js";
import "./chunk-VNSZDDLF.js";
import "./chunk-52LMGFOE.js";
import "./chunk-Y7P2LMY3.js";
import "./chunk-WFA5BPRM.js";
import "./chunk-JZO3AR47.js";
import "./chunk-JKAGDK7D.js";
import "./chunk-MVA4COXB.js";
import "./chunk-BS56CHYG.js";
import "./chunk-AHOTZAW4.js";
import "./chunk-HYO7OXKI.js";
import "./chunk-KIGP26GC.js";
import "./chunk-FH4AHITH.js";
import "./chunk-6FQVBG4D.js";
import "./chunk-VF6IRHEF.js";
import "./chunk-FOSZVHAM.js";
import "./chunk-DCMQC5WO.js";
import {
  selectSvgElement
} from "./chunk-UG5TAK7Y.js";
import {
  configureSvgSize
} from "./chunk-XXSDIRFV.js";
import {
  log
} from "./chunk-J3KGVFTI.js";
import {
  __name
} from "./chunk-HHMJ4QX7.js";
import "./chunk-DC5AMYBS.js";

// ../../node_modules/mermaid/dist/chunks/mermaid.core/infoDiagram-RXCK75RN.mjs
var parser = {
  parse: __name(async (input) => {
    const ast = await parse("info", input);
    log.debug(ast);
  }, "parse")
};
var DEFAULT_INFO_DB = {
  version: "11.17.0" + (true ? "" : "-tiny")
};
var getVersion = __name(() => DEFAULT_INFO_DB.version, "getVersion");
var db = {
  getVersion
};
var draw = __name((text, id, version) => {
  log.debug("rendering info diagram\n" + text);
  const svg = selectSvgElement(id);
  configureSvgSize(svg, 100, 400, true);
  const group = svg.append("g");
  group.append("text").attr("x", 100).attr("y", 40).attr("class", "version").attr("font-size", 32).style("text-anchor", "middle").text(`v${version}`);
}, "draw");
var renderer = { draw };
var diagram = {
  parser,
  db,
  renderer
};
export {
  diagram
};
//# sourceMappingURL=infoDiagram-RXCK75RN-PUIXSVLW.js.map
