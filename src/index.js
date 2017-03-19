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

var CompileError = function (message) {
  this.message = message;
};

var COW = '🐮';
var PLACEHOLDER = '<!--' + COW + '-->';

// Wrap the ATTRIBUTE_NAME_STATE of the tokenizer
// to tweak parsing of the placeholder within tag attributes.
var ATTRIBUTE_NAME_STATE = Tokenizer.prototype.ATTRIBUTE_NAME_STATE;
Tokenizer.prototype.ATTRIBUTE_NAME_STATE = function (cp) {
  // make sure we don't shift out of the attribute name
  // if we encounter a closing angle bracket that is part
  // of the placeholder
  if (cp === 0x3E && this.currentAttr.name.endsWith('<!--' + COW + '--')) {
    this.currentAttr.name = this.currentAttr.name + '>';
    // eslint-disable-next-line no-underscore-dangle
    this._leaveAttrName('AFTER_ATTRIBUTE_NAME_STATE');
  } else {
    // eslint-disable-next-line new-cap
    ATTRIBUTE_NAME_STATE.call(this, cp);
  }
};
// Also disable checking for duplicate attributes at the HTML-parsing stage.
// eslint-disable-next-line no-underscore-dangle
Tokenizer.prototype._isDuplicateAttr = function () { return false; };


var HTMLAttrToReactAttr = {};
Object.keys(HTMLDOMPropertyConfig.DOMAttributeNames).forEach(
  function (reactAttr) {
    HTMLAttrToReactAttr[
      HTMLDOMPropertyConfig.DOMAttributeNames[reactAttr]] = reactAttr;
  }
);

var reactifyAttr = function (name, value) {
  // make sure we give React a truthy value for boolean attributes
  var props = HTMLDOMPropertyConfig.Properties[name];
  // eslint-disable-next-line no-bitwise
  if (props && (props & DOMProperty.injection.HAS_BOOLEAN_VALUE) &&
      value === '') {
    value = name;
  }
  name = HTMLAttrToReactAttr[name] || name;
  return [ name, value ];
};

var TreeAdapter = function (tpltags) {

  this.uncowify = function (text, inAttrName, blocks) {
    var parts = text.split(PLACEHOLDER);
    var length = parts.length;
    for (var i = 0; i < length - 1; i = i + 1) {
      parts.splice((i * 2) + 1, 0, tpltags.shift());
    }
    if (blocks === undefined) {
      blocks = [[]];
    }
    parts.forEach(function (node) {
      if (typeof node === 'string') {
        if (node !== '') {
          blocks[blocks.length - 1].push({
            node: 'text',
            value: node
          });
        }
      } else if (node.node === 'if' || node.node === 'for') {
        blocks[blocks.length - 1].push(node);
        blocks.tag = node;
        blocks.push(node.block);
      } else if (node.node === 'elif' || node.node === 'else') {
        blocks.tag.else = node;
        blocks.tag = node;
        blocks.pop(); blocks.push(node.block);
      } else if (node.node === 'endif' || node.node === 'endfor') {
        blocks.pop();
        return;
      } else if (node.node === 'expression') {
        blocks[blocks.length - 1].push(node.body);
      } else if (node.node === 'comment') {
        // No-op
      } else {
        throw new CompileError(node.node + ' invalid in attributes.');
      }
    });
    return blocks;
  };

  this.uncowifyAttrValue = function (text) {
    var blocks = this.uncowify(text);
    if (blocks[0].length === 0) {
      return '';
    }
    if (blocks[0].length === 1 && blocks[0][0].node === 'text') {
      return blocks[0][0].value;
    }
    return blocks[0];
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
      var startingLastBlock = blocks[blocks.length - 1];
      var startingBlockLength = startingLastBlock.length;

      this.uncowify(attr.name, true, blocks);

      var lastBlock = blocks[blocks.length - 1];
      var newIndex = lastBlock === startingLastBlock ? startingBlockLength : 0;
      var newNodes = lastBlock.slice(newIndex);
      var name;
      if (newNodes.length === 1 && newNodes[0].node === 'text') {
        name = newNodes[0].value;
      } else {
        name = newNodes;
      }
      if (newNodes.length) {
        lastBlock.splice(newIndex, lastBlock.length, {
          node: 'attr',
          name: name,
          value: this.uncowifyAttrValue(attr.value)
        });
      }
    }, this);
    return {
      node: 'element',
      tag: tagName,
      namespace: namespaceURI,
      attrs: blocks[0],
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
    if (newNode.node === 'if' || newNode.node === 'for' || newNode.node === 'macro') {
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
    } else if (newNode.node === 'endif' || newNode.node === 'endfor' || newNode.node === 'endmacro') {
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

var Compiler = function () {

  this.compileExpr = function (node, key) {
    var value = 'undefined';
    if (node.node === 'text') {
      value = escapeLiteral(node.value);
    } else if (node.node === 'element') {
      value = this.compileElement(node, key);
    } else if (node.node === 'boolean' || node.node === 'float') {
      value = node.value.toString();
    } else if (node.node === 'variable') {
      // @@@ error if not defined
      value = 'ctx["' + node.name + '"]';
    } else if (node.node === 'getattr') {
      value = this.compileExpr(node.base) + '.' + node.name;
    } else if (node.node === 'getitem') {
      value = (
        this.compileExpr(node.base) + '[' + this.compileExpr(node.name) + ']');
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
        node.block.map(this.compileExpr, this).join(' + ') +
        '; }.bind(ctx)'
      );
      value = '(' + this.compileExpr(node.range) + ').map(' + fn + ')';
    } else if (node.node === 'attr') {
      var attrName;
      if (typeof node.name === 'string') {
        attrName = escapeLiteral(node.name);
      } else {
        attrName = node.name.map(this.compileExpr, this).join(' + ');
      }
      var attrValue = escapeLiteral(node.value);
      value = '[' + attrName + ', ' + attrValue + ']';
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
    var attrs;
    var attrKV = [];
    var onlySimpleAttrs = true;
    if (node.attrs.length) {
      node.attrs.forEach(function (attr) {
        if (attr.node !== 'attr' || typeof attr.name !== 'string') {
          onlySimpleAttrs = false;
          return;
        }
        var value;
        var parts = reactifyAttr(attr.name, attr.value);
        var name = parts[0];
        var attrValue = parts[1];
        if (typeof attr.value === 'string') {
          value = escapeLiteral(attrValue);
        } else {
          value = '""';
          attrValue.forEach(function (valueNode) {
            var expr = this.compileExpr(valueNode);
            if (valueNode.node === 'for') {
              value = value + ' + ' + expr + '.join("")';
            } else {
              value = value + ' + ' + expr;
            }
          }, this);
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
      attrs = attrs + '["key", "' + key.toString() + '"], ';
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
      '  return ' + this.compileExpr(node) + ';\n})'
    );
  };
};

var Context = function () {
  this.collectAttrs = function (dest, src) {
    src.forEach(function (attr) {
      if (attr) {
        var name = attr[0];
        if (Array.isArray(name)) {
          this.collectAttrs(dest, attr);
        } else {
          var value = attr[1];
          var parts = reactifyAttr(name, value);
          dest[parts[0]] = parts[1];
        }
      }
    }, this);
  };

  this.buildAttrs = function () {
    var attrs = {};
    this.collectAttrs(attrs, Array.from(arguments));
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
      if (parseError.expected && parseError.expected[0].type === 'end') {
        end = pos + parseError.location.end.offset - 1;
        cud = cowParser.parse(str.substring(pos, end));
      } else {
        console.log(pos);
        console.log(parseError.location);
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
