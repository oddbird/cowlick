'use strict';

var assert = require('assert');
var async = require('async');
var fs = require('fs');
var path = require('path');
var cowlick = require('./../src/index.js');
var ReactDOMServer = require('react-dom/server');

var testCases = fs.readdirSync(path.join(__dirname, 'cases'));

async.each(testCases, function (filename, cb) {
  describe(filename, function () {
    it('renders', function (done) {
      fs.readFile(
        path.join(__dirname, 'cases', filename), 'utf8',
        function (err, data) {
          if (err) { throw err; }
          var parts = data.split(/\n[^\S\n]*---[^\S\n]*\n/);
          var input = parts[0];
          var context, expected, tree;
          if (parts.length === 3) {
            context = JSON.parse(parts[1]);
            expected = parts[2];
          } else if (parts.length === 2) {
            context = {};
            expected = parts[1];
          } else {
            throw new Error('Expected input/output or input/context/output;' +
              ' found ' + parts.length + 'parts.');
          }

          try {
            tree = new cowlick.Template(input).render(context);
            var output = ReactDOMServer.renderToStaticMarkup(tree);
            // don't count the div wrapping the result
            output = output.substring(5, output.length - 6) + '\n';
            assert.equal(output, expected);
          } catch (parseErr) {
            tree = new cowlick.Template(input, { debug: true }).render(context);
            throw parseErr;
          }

          done(err);
        }
      );
    });

  });
  cb();
});


describe('Compiler', function () {
  describe('compileExpr', function () {
    it('throws error on unrecognized node type', function () {
      try {
        new cowlick.Compiler().compileExpr({ node: 'bogus' });
      } catch (err) {
        assert.equal(err.message, 'Unexpected node type: bogus');
      }
    });
  });

  describe('compile', function () {
    it('throws error on unrecognized node type', function () {
      try {
        new cowlick.Compiler('').compile({ node: 'bogus' });
      } catch (err) {
        assert.equal(err.message, 'Unexpected node type: bogus');
      }
    });
  });
});

describe('Template', function () {
  it('throws syntax error', function () {
    try {
      new cowlick.Template('{{').render();
    } catch (err) {
      assert.equal(err.name, 'SyntaxError');
    }
  });
});
