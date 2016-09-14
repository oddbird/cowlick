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

var parse5 = require('parse5');
var React = require('react'); // eslint-disable-line no-unused-vars

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
    return parts.map(function (part) {
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
      attr.value = this.uncowify(attr.value);
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


var Compiler = function () {
  this.out = [];

  this.emitLine = function (code) {
    this.out.push(code + '\n');
  };

  this.compile = function (node, key) {
    if (node.node === 'text') {
      this.emitLine('nodes.push("' + escapeLiteral(node.value) + '");');
    } else if (node.node === 'variable') {
      this.emitLine('nodes.push(context["' + node.name + '"]);');
    } else {
      if (node.children.length) {
        this.emitLine('stack.push(nodes); nodes = [];');
        node.children.forEach(function (child, i) {
          this.compile(child, i);
        }, this);
        this.emitLine('children = nodes; nodes = stack.pop();');
      } else {
        this.emitLine('children = [];');
      }

      this.emitLine('attrs = {};');
      node.attrs.forEach(function (attr) {
        var name = attr.name;
        if (name === 'class') { name = 'className'; }
        if (name === 'for') { name = 'htmlFor'; }
        this.emitLine('stack.push(nodes); nodes = [];');
        attr.value.forEach(function (attrnode) {
          this.compile(attrnode);
        }, this);
        this.emitLine('attrs["' + escapeLiteral(name) + '"]' +
          ' = nodes.join(""); nodes = stack.pop();');
      }, this);
      if (key !== undefined) {
        this.emitLine('attrs.key = "' + escapeLiteral(key.toString()) + '";');
      }

      this.emitLine('nodes.push(React.createElement("' +
        node.tag + '", attrs, children));');
    }
  };

  this.getCode = function () {
    this.emitLine('return nodes[0];');
    this.emitLine('})');
    return this.out.join('');
  };

  this.emitLine('(function fn (context) {');
  this.emitLine('var nodes = [];');
  this.emitLine('var stack = [nodes];');
  this.emitLine('var children, attrs;');
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
  // (@@@ this needs to actually parse template syntax)
  var tpltags = [];
  str = str.replace(/{{(.*?)}}/g, function (tag, match) {
    tpltags.push({
      node: 'variable',
      name: match.trim()
    });
    return PLACEHOLDER;
  });

  var tree = parse5.parseFragment(
    str, { treeAdapter: new TreeAdapter(tpltags) });

  var code = this.compile(tree);
  this.compiled = eval(code); // eslint-disable-line no-eval
};

module.exports.Template = Template;
