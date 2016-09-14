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
          var parts = data.split(/\n\s*---\s*\n/);
          var input = parts[0];
          var context, expected;
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

          var tree = new cowlick.Template(input).render(context);
          var output = ReactDOMServer.renderToStaticMarkup(tree);
          // don't count the div wrapping the result
          output = output.substring(5, output.length - 6) + '\n';

          assert.equal(output, expected);
          done(err);
        }
      );
    });
  });
  cb();
});
