/* eslint-disable no-console */

'use strict';

var fs = require('fs');
var peg = require('pegjs');
var React = require('react');
var ReactDOMServer = require('react-dom/server');

var grammar = fs.readFileSync('./src/grammar.txt', 'utf8');
var parser = peg.generate(grammar);
var tplStr = fs.readFileSync('./test/templates/example.html', 'utf8');

function escapeLiteral(s) {
  s = s.replace(/\\/g, '\\\\');
  s = s.replace(/"/g, '\\"');
  s = s.replace(/\n/g, '\\n');
  s = s.replace(/\r/g, '\\r');
  s = s.replace(/\t/g, '\\t');
  return s;
}

class Compiler {
  constructor () {
    this.out = [];
    this.emitLine('(function fn (context) {');
    this.emitLine('var stack = [];');
    this.emitLine('var children = [];');
    this.emitLine('var node;');
  }

  emitLine (code) {
    this.out.push(code + '\n');
  }

  compileNode(node) {
    if (typeof node === 'string') {
      this.emitLine('node = "' + escapeLiteral(node) + '";');
    } else if (node.type === 'variable') {
      this.emitLine('node = context["' + node.name + '"];');
    } else {
      const attrs = {};
      node.attrs.forEach((attr) => {
        var name = attr.name;
        if (name == 'class') name = 'className';
        if (name == 'for') name = 'htmlFor';
        attrs[name] = attr.value;
      });
      if (node.children.length) {
        node.children.forEach((child) => {
          this.emitLine('stack.push(children); children = [];');
          this.compileNode(child);
          this.emitLine('children = stack.pop();');
          this.emitLine('children.push(node);');
        });
        this.emitLine('node = React.createElement("' +
          node.tag + '", ' + JSON.stringify(attrs) + ', children);');
      } else {
        this.emitLine('node = React.createElement("' +
          node.tag + '", ' + JSON.stringify(attrs) + ', []);');
      }
    }
  }

  getCode () {
    this.emitLine('return node;');
    this.emitLine('})');
    return this.out.join('');
  }
}

class Template {
  constructor (s) {
    const tree = parser.parse(s);
    const code = this.compile(tree);
    this.compiled = eval(code);
  }

  compile (tree) {
    const compiler = new Compiler();
    compiler.compileNode(tree);
    const result = compiler.getCode();
    console.log(result);
    return result;
  }

  render (context) {
    const result = this.compiled(context);
    console.log(result);
    return result;
  }
}

var tpl = new Template(tplStr);
var result = ReactDOMServer.renderToStaticMarkup(tpl.render({
  'org': 'OddBird'
}));

module.exports = result;
