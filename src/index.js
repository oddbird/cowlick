/* eslint-disable no-console */

'use strict';

var fs = require('fs');
var peg = require('pegjs');
var React = require('react');
var ReactDOMServer = require('react-dom/server');

var grammar = fs.readFileSync('./src/grammar.txt', 'utf8');
var parser = peg.generate(grammar);
var tplStr = fs.readFileSync('./test/templates/example.html', 'utf8');

var treeToReact = function (node) {
  if (typeof node === 'string') {
    return node;
  }
  var attrs = {};
  node.attrs.forEach(function (attr) {
    attrs[attr.name] = attr.value;
  });
  return React.createElement(
    node.tag,
    attrs,
    node.children.map(treeToReact)
  );
};

var Template = function (str) {
  this.compile = function (thisString) {
    var tree = parser.parse(thisString);
    return function (context) { // eslint-disable-line no-unused-vars
      return React.createElement(
        'div',
        null,
        tree.map(treeToReact)
      );
    };
  };

  this.render = function (context) {
    var result = this.runtime(context);
    return result;
  };

  this.runtime = this.compile(str);
};

var tpl = new Template(tplStr);
var result = ReactDOMServer.renderToStaticMarkup(tpl.render());

console.log(result);
module.exports = result;
