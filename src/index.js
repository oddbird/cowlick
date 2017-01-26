'use strict';

/*
Cow parser

{% if foo %}
  <div>
    {% if bar %}
      <a data-baz="{{ "}}" }}">asdf</p>
    {% endif %}
  </div>
{% endif %}

1. Replace template tags with placeholder

   Currently looking for {{ .*? }} with a regexp.
   Creates a variable node for the match and puts in `tpltags` list,
   then replaces the match with a placeholder (🐮).

   Needs to also handle {% %}, {# #},
   and needs to rely on the cow parser to know
   where the tag ends.

2. Parse HTML into abstract syntax tree (AST)

   We are using the `parse5` library, a spec-compliant HTML 5 parser.
   When the placeholder is found in an attribute or text,
   replace it with the cow parse result stored in `tpltags` above.

3. Match template tags

   (TODO)
   Find matching start/end template tags and turn the nodes in between
   into children.

4. Compile AST into function mapping a template context to a virtual DOM tree.

   We do depth-first traversal of the AST and write code that
   first creates the inner vdom elements, then creates parents referencing
   their children.

*/

var fs = require('fs');
var parse5 = require('parse5');
var path = require('path');
var pegjs = require('pegjs');
var DOMProperty = require('react/lib/DOMProperty');
var HTMLDOMPropertyConfig = require('react/lib/HTMLDOMPropertyConfig');
var React = require('react'); // eslint-disable-line no-unused-vars
var util = require('util');

var escapeLiteral = function (str) {
  str = str.replace(/\\/g, '\\\\');
  str = str.replace(/"/g, '\\"');
  str = str.replace(/\n/g, '\\n');
  str = str.replace(/\r/g, '\\r');
  str = str.replace(/\t/g, '\\t');
  return str;
};


var PLACEHOLDER = '🐮';

var TreeAdapter = function (tpltags) {

  this.uncowify = function (text) {
    var parts = text.split(PLACEHOLDER);
    var length = parts.length;
    for (var i = 0; i < length - 1; i = i + 1) {
      parts.splice((i * 2) + 1, 0, tpltags.shift());
    }
    return parts.filter(function (part) {
      return part !== '';
    }).map(function (part) {
      if (typeof part === 'string') {
        part = {
          node: 'text',
          value: part
        };
      }
      return part;
    });
  };

  this.createDocumentFragment = function () {
    return {
      node: 'tag',
      tag: 'div',
      attrs: [],
      children: []
    };
  };

  this.createElement = function (tagName, namespaceURI, attrs) {
    attrs.forEach(function (attr) {
      if (attr.value.indexOf(PLACEHOLDER) !== -1) {
        attr.value = this.uncowify(attr.value);
      }
      // make sure we give React a truthy value for boolean attributes
      var props = HTMLDOMPropertyConfig.Properties[attr.name];
      // eslint-disable-next-line no-bitwise
      if (props && (props & DOMProperty.injection.HAS_BOOLEAN_VALUE) &&
          attr.value === '') {
        attr.value = attr.name;
      }
    }, this);
    return {
      node: 'tag',
      tag: tagName,
      namespace: namespaceURI,
      attrs: attrs,
      children: []
    };
  };

  this.appendChild = function (parentNode, newNode) {
    parentNode.children.push(newNode);
    newNode.parent = parentNode;
  };

  this.detachNode = function (node) {
    var idx = node.parent.children.indexOf(node);
    node.parent.children.splice(idx, 1);
    node.parent = null;
  };

  this.insertText = function (parentNode, text) {
    var nodes = this.uncowify(text);
    nodes.forEach(function (newNode) {
      this.appendChild(parentNode, newNode);
    }, this);
  };

  this.getFirstChild = function (node) {
    return node.children[0];
  };

  this.getParentNode = function (node) {
    return node.parent;
  };

  this.getTagName = function (element) {
    return element.tag;
  };

  this.getNamespaceURI = function (element) {
    return element.namespace;
  };
};

var grammar = fs.readFileSync(path.join(__dirname, 'grammar.txt'), 'utf8');
var cowParser = pegjs.generate(grammar);

var Compiler = function () {
  this.out = [];

  this.emitLine = function (code) {
    this.out.push(code + '\n');
  };

  this.emitNode = function (code) {
    this.emitLine('nodes.push(' + code + ');');
  };

  this.compile = function (node, key) {
    if (node.node === 'text' || node.node === 'string') {
      this.emitNode('"' + escapeLiteral(node.value) + '"');
    } else if (node.node === 'expression') {
      this.scopedCompile(node.body, 'children');
      this.emitNode('children[0].toString()');
    } else if (node.node === 'boolean' || node.node === 'float') {
      this.emitNode(node.value);
    } else if (node.node === 'variable') {
      this.emitNode('context["' + node.name + '"]');
    } else if (node.node === 'if') {
      this.scopedCompile(node.condition, 'cond');
      this.emitLine('if (cond) {');
    } else if (node.node === 'elif') {
      this.emitLine('} else if ((function (nodes) {');
      this.compile(node.condition);
      this.emitLine('return nodes[0]; })([])) {');
    } else if (node.node === 'else') {
      this.emitLine('} else {');
    } else if (node.node === 'endif') {
      this.emitLine('}');
    } else {
      if (node.children.length) {
        this.emitLine('stack.push(nodes); nodes = [];');
        node.children.forEach(function (child, i) {
          this.compile(child, i);
        }, this);
      }

      this.emitLine('attrs = {};');
      node.attrs.forEach(function (attr) {
        var name = attr.name;
        if (name === 'class') { name = 'className'; }
        if (name === 'for') { name = 'htmlFor'; }
        if (typeof attr.value === 'string') {
          this.emitLine(
            'attrs["' + escapeLiteral(name) + '"]' +
            ' = "' + escapeLiteral(attr.value) + '";');
        } else {
          this.emitLine('stack.push(nodes); nodes = [];');
          attr.value.forEach(function (attrnode) {
            this.compile(attrnode);
          }, this);
          this.emitLine('attrs["' + escapeLiteral(name) + '"]' +
            ' = nodes.join(""); nodes = stack.pop();');
        }
      }, this);
      if (key !== undefined) {
        this.emitLine('attrs.key = "' + escapeLiteral(key.toString()) + '";');
      }

      if (node.children.length) {
        this.emitLine(
          'children = nodes.length ? nodes : null; nodes = stack.pop();');
      } else {
        this.emitLine('children = null;');
      }
      this.emitNode(this.createElement(node.tag, 'attrs', 'children'));
    }
  };

  this.scopedCompile = function (node, result) {
    this.emitLine('stack.push(nodes); nodes = [];');
    this.compile(node);
    this.emitLine(result + ' = nodes; nodes = stack.pop();');
  };

  this.createElement = function (tag, attrs, children) {
    return (
      'React.createElement("' + tag + '", ' + attrs + ', ' + children + ')');
  };

  this.getCode = function () {
    this.emitLine('return nodes[0];');
    this.emitLine('})');
    return this.out.join('');
  };

  this.emitLine('(function fn (context) {');
  this.emitLine('var nodes = [];');
  this.emitLine('var stack = [nodes];');
  this.emitLine('var children, attrs, cond;');
};

var Template = function (str) {

  this.compile = function (tree) {
    var compiler = new Compiler();
    compiler.compile(tree);
    return compiler.getCode();
  };

  this.render = function (context) {
    return this.compiled(context);
  };

  // Replace template tags with placeholders
  var tpltags = [];
  var pos = 0;
  while (pos < str.length) {
    var offset = str.substring(pos).search(/{[{%#]/);
    if (offset === -1) {
      break;
    }
    pos = pos + offset;
    var cud, end;
    try {
      cud = cowParser.parse(str.substring(pos));
      end = str.length;
    } catch (parseError) {
      if (parseError.expected[0].type === 'end') {
        end = pos + parseError.location.end.offset - 1;
        cud = cowParser.parse(str.substring(pos, end));
      } else {
        throw parseError;
      }
    }
    tpltags.push(cud);
    str = str.substring(0, pos) + PLACEHOLDER + str.substring(end);
    pos = pos + PLACEHOLDER.length;
  }

  var tree = parse5.parseFragment(
    str, { treeAdapter: new TreeAdapter(tpltags) });
  console.log(util.inspect(tree, { depth: 8 }));

  var code = this.compile(tree);
  console.log(code);
  this.compiled = eval(code); // eslint-disable-line no-eval
};

module.exports.Template = Template;
