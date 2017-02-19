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

   Looks for matching {{ }}, {% %} and {# #} with a regexp.
   Creates a variable node for the match and puts in `tpltags` list,
   then replaces the match with a placeholder (<!--🐮-->).

2. Parse HTML into abstract syntax tree (AST)

   We are using the `parse5` library, a spec-compliant HTML 5 parser.
   When the placeholder comment is found in an attribute or text,
   replace it with the cow parse result stored in `tpltags` above.

   As nodes are added to the tree, find matching start/end template tags
   and turn the nodes in between into children.

3. Compile AST into function mapping a template context to a virtual DOM tree.

   We do depth-first traversal of the AST and write code
   for a function to render virtual DOM elements.

*/

var fs = require('fs');
var parse5 = require('parse5');
var Tokenizer = require('parse5/lib/tokenizer');
var path = require('path');
var pegjs = require('pegjs');
var DOMProperty = require('react-dom/lib/DOMProperty');
var HTMLDOMPropertyConfig = require('react-dom/lib/HTMLDOMPropertyConfig');
var React = require('react');  // eslint-disable-line no-unused-vars
// var util = require('util');

var escapeLiteral = function (str) {
  str = str.replace(/\\/g, '\\\\');
  str = str.replace(/"/g, '\\"');
  str = str.replace(/\n/g, '\\n');
  str = str.replace(/\r/g, '\\r');
  str = str.replace(/\t/g, '\\t');
  return '"' + str + '"';
};


var COW = '🐮';
var PLACEHOLDER = '<!--' + COW + '-->';

// Wrap the ATTRIBUTE_NAME_STATE of the tokenizer
// to tweak parsing of the placeholder within tag attributes.
var ATTRIBUTE_NAME_STATE = Tokenizer.prototype.ATTRIBUTE_NAME_STATE;
Tokenizer.prototype.ATTRIBUTE_NAME_STATE = function (cp) {
  // make sure we consume the closing angle bracket
  // and avoid duplicate attribute names
  if (cp === 0x3E && this.currentAttr.name === '<!--' + COW + '--') {
    this.cowCount = (this.cowCount || 0) + 1;
    this.currentAttr.name = COW + this.cowCount;
    // eslint-disable-next-line no-underscore-dangle
    this._leaveAttrName('AFTER_ATTRIBUTE_NAME_STATE');
  } else {
    // eslint-disable-next-line new-cap
    ATTRIBUTE_NAME_STATE.call(this, cp);
  }
};

var TreeAdapter = function (tpltags) {

  this.uncowifyAttrValue = function (text) {
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
          node: 'string',
          value: part
        };
      } else if (part.node === 'expression') {
        part = part.body;
      }
      return part;
    });
  };

  this.createDocumentFragment = function () {
    return {
      node: 'element',
      tag: 'div',
      attrs: [],
      children: []
    };
  };

  this.createElement = function (tagName, namespaceURI, attrs) {
    var blocks = [[]];
    attrs.forEach(function (attr) {
      if (attr.name.startsWith(COW)) {
        var node = tpltags.shift();
        if (node.node === 'if' || node.node === 'for') {
          blocks[blocks.length - 1].push(node);
          blocks.push(node.block);
          return;
        } else if (node.node === 'elif' || node.node === 'else') {
          var ifnode = blocks.pop();
          ifnode.else = node;
          blocks.push(node.block);
        } else if (node.node === 'endif' || node.node === 'endfor') {
          blocks.pop();
          return;
        }
      }
      attr.node = 'attr';
      if (attr.value.indexOf(PLACEHOLDER) !== -1) {
        attr.value = this.uncowifyAttrValue(attr.value);
      }
      // make sure we give React a truthy value for boolean attributes
      var props = HTMLDOMPropertyConfig.Properties[attr.name];
      // eslint-disable-next-line no-bitwise
      if (props && (props & DOMProperty.injection.HAS_BOOLEAN_VALUE) &&
          attr.value === '') {
        attr.value = attr.name;
      }
      blocks[blocks.length - 1].push(attr);
    }, this);
    return {
      node: 'element',
      tag: tagName,
      namespace: namespaceURI,
      attrs: blocks.pop(),
      children: []
    };
  };

  this.createCommentNode = function (data) {
    if (data === COW) {
      return tpltags.shift();
    }
    return {
      node: 'comment',
      data: data,
    };
  };

  this.appendChild = function (parentNode, newNode) {
    if (newNode.block && newNode.block.length) {
      // transplanting a block that was already processed
      parentNode.children.push(newNode);
      newNode.parent = parentNode;
      return;
    }
    if (newNode.node === 'if' || newNode.node === 'for') {
      parentNode.tplTag = newNode;
      parentNode.block = newNode.block;
      parentNode.children.push(newNode);
      newNode.parent = parentNode;
    } else if (newNode.node === 'elif') {
      // @@@ error if not in if or elif
      parentNode.tplTag.else = newNode;
      parentNode.tplTag = newNode;
      parentNode.block = newNode.block;
    } else if (newNode.node === 'else') {
      // @@@ error if not in if or elif
      parentNode.tplTag.else = newNode;
      parentNode.block = newNode.block;
    } else if (newNode.node === 'endif' || newNode.node === 'endfor') {
      // @@@ error if not in correct block
      parentNode.tplTag = parentNode.block = null;
    } else if (parentNode.block) {
      // inside a template tag; add to its block
      parentNode.block.push(newNode);
    } else {
      // not inside a template tag
      parentNode.children.push(newNode);
      newNode.parent = parentNode;
    }
  };

  this.detachNode = function (node) {
    var idx = node.parent.children.indexOf(node);
    node.parent.children.splice(idx, 1);
    node.parent = null;
  };

  this.insertText = function (parentNode, text) {
    this.appendChild(parentNode, {
      node: 'text',
      value: text
    });
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

  this.isQuirksMode = function () {
    return false;
  };
};

var grammar = fs.readFileSync(path.join(__dirname, 'grammar.txt'), 'utf8');
var cowParser = pegjs.generate(grammar);

var CompileError = function (message) {
  this.message = message;
};

var Compiler = function () {

  this.compileExpr = function (node, key) {
    var value = 'undefined';
    if (node.node === 'string' || node.node === 'text') {
      value = escapeLiteral(node.value);
    } else if (node.node === 'element') {
      value = this.compileElement(node, key);
    } else if (node.node === 'boolean' || node.node === 'float') {
      value = node.value.toString();
    } else if (node.node === 'variable') {
      // @@@ error if not defined
      value = 'ctx["' + node.name + '"]';
    } else if (node.node === 'if' || node.node === 'elif') {
      value = (
        '(' + this.compileExpr(node.condition) + ' ? ' +
        node.block.map(this.compileExpr, this) + ' : ' +
        (node.else ? this.compileExpr(node.else) : 'null') + ')'
      );
    } else if (node.node === 'else') {
      value = node.block.map(this.compileExpr, this);
    } else if (node.node === 'expression') {
      value = this.compileExpr(node.body);
    } else if (node.node === 'for') {
      // @@@ These function definitions should be hoisted
      // to be static functions rather than closures
      // @@@ Use a Frame/Scope object rather than
      // creating the stacked scope using inline Object.create?
      var fn = (
        'function (i) {' +
        'var ctx = Object.create(this);' +
        'ctx[' + escapeLiteral(node.loopvar) + '] = i;' +
        'return ' +
        '"" + ' + node.block.map(this.compileExpr, this).join(' + ') +
        '; }.bind(ctx)'
      );
      value = '(' + this.compileExpr(node.range) + ').map(' + fn + ')';
    } else if (node.node === 'attr') {
      var attrValue = node.value;
      if (typeof attrValue === 'string') {
        attrValue = escapeLiteral(attrValue);
      } else {
        attrValue = attrValue.map(this.compileExpr, this).join(' + ');
      }
      value = '[' + escapeLiteral(node.name) + ', ' + attrValue + ']';
    } else if (node.node === 'comment') {
      // No way to render HTML comments using React :(
      // https://github.com/facebook/react/issues/2810
      value = escapeLiteral('');
    } else {
      throw new CompileError('Unexpected node type: ' + node.node);
    }
    return value;
  };

  this.compileElement = function (node, key) {
    // buildAttrs(
    //   ["className": ()]
    // );

    var attrs;
    var attrKV = [];
    var onlySimpleAttrs = true;
    if (node.attrs.length) {
      node.attrs.forEach(function (attr) {
        if (attr.node !== 'attr') {
          onlySimpleAttrs = false;
          return;
        }
        var name = attr.name;
        var value;
        if (name === 'class') { name = 'className'; }
        if (name === 'for') { name = 'htmlFor'; }
        if (typeof attr.value === 'string') {
          value = escapeLiteral(attr.value);
        } else {
          value = '"" + ' + attr.value.map(this.compileExpr, this).join(' + ');
        }
        attrKV.push(escapeLiteral(name) + ': ' + value);
      }, this);
    }
    if (onlySimpleAttrs) {
      if (key !== undefined) {
        attrKV.push('"key": "' + key.toString() + '"');
      }
      if (attrKV.length) {
        attrs = '{' + attrKV.join(', ') + '}';
      } else {
        attrs = 'undefined';
      }
    } else {
      attrs = 'ctx.buildAttrs(';
      if (key !== undefined) {
        attrs = attrs + '["key", "' + key.toString() + '"], ';
      }
      attrs = attrs + node.attrs.map(this.compileExpr, this).join(', ') + ')';
    }

    var children = 'undefined';
    if (node.children.length) {
      // @@@ not sure this does the right thing if child
      // compiles to a list (like `for`)
      children = (
        '[' + node.children.map(this.compileExpr, this).join(', ') + ']');
    }

    return this.createElement(node.tag, attrs, children);
  };

  this.createElement = function (tag, attrs, children) {
    return (
      'React.createElement("' + tag + '", ' + attrs + ', ' + children + ')');
  };

  this.compile = function (node) {
    return (
      '(function fn (ctx) {\n' +
      '  return ' + this.compileExpr(node) + '\n})'
    );
  };
};

var Context = function () {
  this.buildAttrs = function () {
    var attrs = {};
    Array.from(arguments).forEach(function (attr) {
      if (attr) {
        var name = attr[0];
        var value = attr[1];
        if (name === 'class') { name = 'className'; }
        if (name === 'for') { name = 'htmlFor'; }
        attrs[name] = value;
      }
    });
    return attrs;
  };
};

var Template = function (str, options) {
  options = options || {};

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
  /* istanbul ignore next */
  if (options.debug) {
    var util = require('util'); console.log(util.inspect(tree, { depth: 8 }));
  }

  var code = new Compiler().compile(tree);
  /* istanbul ignore next */
  if (options.debug) {
    console.log(code);
  }
  var render = eval(code);  // eslint-disable-line no-eval

  this.render = function (context) {
    var ctx = Object.assign(new Context(), context);
    return render(ctx);
  };
};

module.exports.Compiler = Compiler;
module.exports.Template = Template;
