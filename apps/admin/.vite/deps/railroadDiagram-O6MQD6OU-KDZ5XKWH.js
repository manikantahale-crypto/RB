import {
  db,
  getStyles,
  renderer
} from "./chunk-5OBZHIZ2.js";
import {
  populateCommonDb
} from "./chunk-LXGF5XG7.js";
import {
  MermaidParseError
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
import {
  createRailroadServices
} from "./chunk-VF6IRHEF.js";
import "./chunk-FOSZVHAM.js";
import "./chunk-DCMQC5WO.js";
import "./chunk-UG5TAK7Y.js";
import "./chunk-XXSDIRFV.js";
import {
  log
} from "./chunk-J3KGVFTI.js";
import {
  __name
} from "./chunk-HHMJ4QX7.js";
import "./chunk-DC5AMYBS.js";

// ../../node_modules/mermaid/dist/chunks/mermaid.core/railroadDiagram-O6MQD6OU.mjs
var langiumParser = createRailroadServices().Railroad.parser.LangiumParser;
var transformExpression = __name((expr) => {
  switch (expr.$type) {
    case "RailroadTerminalExpr":
      return {
        type: "terminal",
        value: expr.value
      };
    case "RailroadNonTerminalExpr":
      return {
        type: "nonterminal",
        name: expr.name
      };
    case "RailroadSpecialExpr":
      return {
        type: "special",
        text: expr.text
      };
    case "RailroadSequenceExpr": {
      const elements = expr.elements.map(transformExpression);
      return elements.length === 1 ? elements[0] : { type: "sequence", elements };
    }
    case "RailroadChoiceExpr": {
      const alternatives = expr.alternatives.map(transformExpression);
      return alternatives.length === 1 ? alternatives[0] : { type: "choice", alternatives };
    }
    case "RailroadOptionalExpr":
      return {
        type: "optional",
        element: transformExpression(expr.element)
      };
    case "RailroadOneOrMoreExpr":
      return {
        type: "repetition",
        element: transformExpression(expr.element),
        min: 1,
        max: Infinity
      };
    case "RailroadZeroOrMoreExpr":
      return {
        type: "repetition",
        element: transformExpression(expr.element),
        min: 0,
        max: Infinity
      };
    default:
      throw new Error(`Unsupported railroad expression: ${expr.$type}`);
  }
}, "transformExpression");
var transformRule = __name((rule) => {
  return {
    name: rule.name,
    definition: transformExpression(rule.definition)
  };
}, "transformRule");
var populateDb = __name((ast) => {
  populateCommonDb(ast, db);
  if (ast.title) {
    db.setTitle(ast.title);
  }
  ast.rules.map((rule) => db.addRule(transformRule(rule)));
}, "populateDb");
var parser = {
  parse: __name((input) => {
    db.clear();
    log.debug("[Railroad Parser] Starting Langium parse");
    const result = langiumParser.parse(input);
    if (result.lexerErrors.length > 0 || result.parserErrors.length > 0) {
      throw new MermaidParseError(result);
    }
    const ast = result.value;
    log.debug("[Railroad Parser] Parsed rules:", ast.rules.length);
    populateDb(ast);
    log.debug("[Railroad Parser] Parse complete");
  }, "parse"),
  parser: {
    yy: db
  }
};
var diagram = {
  parser,
  db,
  renderer,
  styles: getStyles
};
var railroadDiagram_default = diagram;
export {
  railroadDiagram_default as default,
  diagram
};
//# sourceMappingURL=railroadDiagram-O6MQD6OU-KDZ5XKWH.js.map
