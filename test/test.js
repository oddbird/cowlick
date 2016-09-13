'use strict';

var assert = require('assert');
var fs = require('fs');
var result = require('./../src/index.js');

describe('index.js', function () {

  it('returns a string of parsed html', function (done) {
    fs.readFile(
      './test/templates/example_expected.html',
      'utf8',
      function (err, data) {
        if (err) { throw err; }
        assert(data.includes(result));
        done(err);
      });
  });

});
