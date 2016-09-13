'use strict';

var fs = require('fs');
var peg = require('pegjs');
var React = require('react'); // eslint-disable-line no-unused-vars

var grammar = fs.readFileSync('./src/grammar.txt', 'utf8');
var parser = peg.generate(grammar);

var escapeLiteral = function (str) {
  str = str.replace(/\\/g, '\\\\');
  str = str.replace(/"/g, '\\"');
  str = str.replace(/\n/g, '\\n');
  str = str.replace(/\r/g, '\\r');
  str = str.replace(/\t/g, '\\t');
  return str;
};

var Compiler = function () {
  this.out = [];

  this.emitLine = function (code) {
    this.out.push(code + '\n');
  };

  this.compileNode = function (node, key) {
    if (typeof node === 'string') {
      this.emitLine('nodes.push("' + escapeLiteral(node) + '");');
    } else if (node.type === 'variable') {
      this.emitLine('nodes.push(context["' + node.name + '"]);');
    } else {
      var attrs = {};
      node.attrs.forEach(function (attr) {
        var name = attr.name;
        if (name === 'class') { name = 'className'; }
        if (name === 'for') { name = 'htmlFor'; }
        attrs[name] = attr.value;
      });
      if (key !== undefined) {
        attrs.key = key;
      }
      if (node.children.length) {
        this.emitLine('stack.push(nodes); nodes = [];');
        node.children.forEach(function (child, i) {
          this.compileNode(child, i);
        }.bind(this));
        this.emitLine('children = nodes; nodes = stack.pop();');
        this.emitLine('nodes.push(React.createElement("' +
          node.tag + '", ' + JSON.stringify(attrs) + ', children));');
      } else {
        this.emitLine('nodes.push(React.createElement("' +
          node.tag + '", ' + JSON.stringify(attrs) + ', []));');
      }
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
  this.emitLine('var children;');
};

var Template = function (str) {
  this.compile = function (tree) {
    var compiler = new Compiler();
    compiler.compileNode(tree);
    var result = compiler.getCode();
    return result;
  };

  this.render = function (context) {
    var result = this.compiled(context);
    return result;
  };

  var parsed = parser.parse(str);
  var code = this.compile(parsed);
  this.compiled = eval(code); // eslint-disable-line no-eval
};

module.exports.Template = Template;
