'use strict';

var chalk = require('chalk');
var eslint = require('gulp-eslint');
var gulp = require('gulp');
var gutil = require('gulp-util');
var istanbul = require('gulp-istanbul');
var mocha = require('gulp-mocha');

var paths = {
  TESTS_DIR: 'test/',
  SRC_DIR: 'src/',
  IGNORE: [
    '!**/.#*',
    '!**/flycheck_*'
  ],
  init: function () {
    this.ALL_JS = [
      this.SRC_DIR + '**/*.js',
      this.TESTS_DIR + '**/*.js',
      '*.js'
    ].concat(this.IGNORE);
    this.TESTS_FILES = [
      this.SRC_DIR + '**/*',
      this.TESTS_DIR + '**/*'
    ].concat(this.IGNORE);
    return this;
  }
}.init();

var onError = function (err) {
  gutil.log(chalk.red(err.message));
  gutil.beep();
  this.emit('end');
};

var eslintTask = function (src, failOnError, log) {
  if (log) {
    gutil.log('Running', '\'' + chalk.cyan('eslint ' + src) + '\'...');
  }
  var stream = gulp.src(src)
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
  if (!failOnError) {
    stream.on('error', onError);
  }
  return stream;
};

gulp.task('eslint', function () {
  return eslintTask(paths.ALL_JS, true);
});

gulp.task('eslint-nofail', function () {
  return eslintTask(paths.ALL_JS);
});

gulp.task('pre-test', function () {
  return gulp.src(paths.SRC_DIR + '**/*.js')
    .pipe(istanbul({ includeUntested: true }))
    .pipe(istanbul.hookRequire());
});

gulp.task('test', ['pre-test'], function () {
  return gulp.src(paths.TESTS_DIR + '**/*.js')
    .pipe(mocha())
    .pipe(istanbul.writeReports());
});

gulp.task('default', [
  'eslint',
  'test'
]);

// Development task.
gulp.task('develop', [
  'eslint-nofail',
  'test',
], function () {
  gulp.watch(paths.TESTS_FILES, ['test']);

  gulp.watch(paths.ALL_JS, function (ev) {
    if (ev.type === 'added' || ev.type === 'changed') {
      eslintTask(ev.path, false, true);
    }
  });

  gulp.watch('**/.eslintrc.yml', ['eslint-nofail']);
});
