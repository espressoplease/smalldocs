// slides-verify.js - headless validation for Markdown slide fences.
//
// `sdoc slides verify <file.md>` runs the same shape parser, template
// resolver, reference resolver, and grid-bounds check used by the browser.
// It does not render pixels, so visual overlap and contrast still require a
// browser review.

const io = require('./io');
const SDocShapes = require('../shared/sdocs-shapes.js');
const SDocSlideResolve = require('../shared/sdocs-slide-resolve.js');
const SDocSlideStdlib = require('../shared/sdocs-slide-stdlib.js');

function scanSlideBlocks(markdown) {
  var re = /(?:^|\n)(```+|~~~+)slide[ \t]*[^\n]*\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/g;
  var blocks = [];
  var match;
  while ((match = re.exec(String(markdown == null ? '' : markdown)))) {
    blocks.push(match[2]);
  }
  return blocks;
}

function verifySlides(markdown) {
  var raw = scanSlideBlocks(markdown);
  var resolved = SDocSlideResolve.resolveSlides(raw, SDocShapes, {
    stdlib: SDocSlideStdlib.templates || {},
  });
  var slideNumber = 0;
  var results = resolved.map(function (entry, index) {
    if (!entry.skip) slideNumber++;
    var parsed = SDocShapes.parseAndResolve(entry.dsl);
    var errors = (entry.errors || []).concat(parsed.errors || []);
    return {
      source: index + 1,
      slide: entry.skip ? null : slideNumber,
      kind: entry.skip ? 'template' : 'slide',
      ok: errors.length === 0,
      errors: errors,
    };
  });
  var allErrors = [];
  results.forEach(function (result) {
    result.errors.forEach(function (error) {
      allErrors.push({
        source: result.source,
        slide: result.slide,
        kind: result.kind,
        line: error.line || null,
        message: error.message,
      });
    });
  });
  return {
    ok: allErrors.length === 0,
    slideCount: slideNumber,
    sourceCount: raw.length,
    slides: results,
    errors: allErrors,
  };
}

function formatError(error) {
  return (error.line ? 'line ' + error.line + ': ' : '') + error.message;
}

async function slidesVerifyCommand(opts) {
  var file = opts.extra;
  if (!file) {
    console.error('sdoc: slides verify needs a file - usage: sdoc slides verify <file.md> [--json]');
    process.exit(2);
  }
  var content = await io.readContent(file);
  if (content == null) {
    console.error('sdoc: nothing to read from ' + file);
    process.exit(2);
  }
  var report = verifySlides(content);
  if (!report.sourceCount) {
    console.error('sdoc: no slide blocks found in ' + file);
    process.exit(2);
  }

  if (opts.jsonFlag) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    report.slides.forEach(function (result) {
      var label = result.kind === 'slide'
        ? 'slide ' + result.slide
        : 'template source ' + result.source;
      if (result.ok) {
        console.log(label + ': ok');
        return;
      }
      console.log(label + ': ' + result.errors.length + ' error' + (result.errors.length === 1 ? '' : 's'));
      result.errors.forEach(function (error) {
        console.log('  ' + formatError(error));
      });
    });
    console.log(report.slideCount + ' slide' + (report.slideCount === 1 ? '' : 's')
      + ', ' + report.errors.length + ' error' + (report.errors.length === 1 ? '' : 's'));
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  scanSlideBlocks: scanSlideBlocks,
  verifySlides: verifySlides,
  slidesVerifyCommand: slidesVerifyCommand,
};
