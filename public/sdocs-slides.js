// sdocs-slides.js - production adapter for the canonical inline slide reader.
(function () {
  'use strict';

  var controller = window.SDocSlideReader.create({
    shapes: function () { return window.SDocShapes; },
    renderer: function () { return window.SDocShapeRender; },
    resolver: function () { return window.SDocSlideResolve; },
    templates: function () {
      return window.SDocSlideStdlib ? window.SDocSlideStdlib.templates : null;
    },
    present: function (slideIndex) {
      if (window.SDocPresent) window.SDocPresent.open(slideIndex);
    },
    onRefresh: function () {
      if (window.SDocPresent && window.SDocPresent.refresh) window.SDocPresent.refresh();
    },
  });
  var lastRender = null;

  function processSlides(container) {
    lastRender = controller.process(container);
    return lastRender;
  }

  function appendSlideError(wrapper, error) {
    controller.appendSlideError(wrapper, error);
  }

  window.SDocSlides = {
    processSlides: processSlides,
    appendSlideError: appendSlideError,
    ready: function () {
      return lastRender && lastRender.ready ? lastRender.ready : Promise.resolve();
    },
    destroy: function () { controller.destroy(); },
  };
})();
