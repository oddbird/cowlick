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

function attrsArrayToObj (attrs) {
  // TODO handle variables in attrs.
  const ret = {};
  attrs.forEach((attr) => {
    let name = attr.name;
    if (name === 'class') name = 'className';
    if (name === 'for') name = 'htmlFor';
    ret[name] = attr.value;
  });
  return ret;
}

function compile (rootNode) {
  return `(function fn (context) { return `
      + `React.createElement("${ rootNode.tag }", `
      + `${ JSON.stringify(attrsArrayToObj(rootNode.attrs)) }, `
      + `[${ rootNode.children.map((node) => _inner(node)).join(',') }])`
      + `})`;
}

function _inner (node) {
  if (typeof node === 'string') {
    return `"${ node }"`;  // TODO escape this.
  }
  if (node.type === 'variable') {
    return `context['${ node.name }']`;  // TODO escape this.
  }
  return `React.createElement("${ node.tag }", `
    + `${ JSON.stringify(attrsArrayToObj(node.attrs)) }, `
    + `[${ node.children.map((child) => _inner(child) )}])`;
}

class Template {
  constructor (s) {
    const tree = parser.parse(s);
    const code = compile(tree);
    this.compiled = eval(code);
  }

  render (context) {
    return this.compiled(context);
  }
}

var tpl = new Template(tplStr);
var result = ReactDOMServer.renderToStaticMarkup(tpl.render({
  'org': 'OddBird'
}));

module.exports = result;
