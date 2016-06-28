(function () {
  "use strict";

  // ----------
  // Constants

  var CONTAINER_SELECTOR = '.mosaic'
    , INPUT_SELECTOR = '#mosaic-input'
    , BUTTON_SELECTOR = '#mosaic-button'
    , OUTPUT_SELECTOR = '#mosaic-output'
    , SELECTOR_SELECTOR = '.mosaic-selector'
    , PROCESS_SELECTOR = '.mosaic-process'
    , PROGRESS_SELECTOR = '.mosaic-progress-inner'
    , TILE_WORKER_URL = 'js/tile-worker.js'
    , CAN_USE_WORKER = 'Worker' in window
    , IMAGE_REGEXP = /^image\/(jpe?g|png|gif)/
    , SAMPLING_TIMEOUT = 1;

  // ----------
  // Shared variables

  var tileWorker = null
    , isIdle = true
    , totalRows = 0, totalCols = 0
    , tilesColorArray = []
    , image = null
    , ctx = document.createElement('canvas').getContext('2d')
    , tileLoadQueue = []
    , columnsLoaded = []
    , cachedUrls = {};

  // ----------
  // Entry point

  function main() {
    // Initialize tile worker
    if (CAN_USE_WORKER) tileWorker = new Worker(TILE_WORKER_URL);
    else {
      // Or include directly
      var tileScript = document.createElement('script');
      tileScript.src = TILE_WORKER_URL;
      document.body.appendChild(tileScript);
    }

    bindEvents();
  }

  /**
   * Process image file
   * @param {File} file
   * @throws Error
   */
  function processFile(file) {
    if (!isIdle) throw Error('Still busy');
    if (!(file instanceof File)) throw Error('Invalid file');
    if (!IMAGE_REGEXP.test(file.type)) throw Error('Invalid image');

    updateIdle(false);
    document.querySelector(OUTPUT_SELECTOR).innerHTML = '';

    fileToImage(fileToUrl(file)).then(function (image) {
      // Start processing
      processTiles(image, drawImageToCtx(image));
    }, function (error) {
      updateIdle(false);
      alert(error);
    });
  }

  /**
   * @param {Image} image_
   * @param {CanvasRenderingContext2D} context
   */
  function processTiles(image_, context) {
    image = image_;
    totalRows = Math.ceil(image.height / TILE_HEIGHT);
    totalCols = Math.ceil(image.width / TILE_WIDTH);

    // Update dimensions of container
    var cnt = document.querySelector(CONTAINER_SELECTOR);
    cnt.style.width = (totalCols - 1) * TILE_WIDTH + 'px';
    cnt.style.height = totalRows * TILE_HEIGHT + 'px';

    // Abort if no rows or cols found
    if (totalRows === 0 || totalCols === 0) {
      updateIdle(true);
      return;
    }

    // Begin sample process
    processTilesRow(0, image, context);
  }

  /**
   * @param {number} rowNumber
   * @param {Image} image
   * @param {CanvasRenderingContext2D} context
   */
  function processTilesRow(rowNumber, image, context) {
    // Read row of data from image
    var imageData = context.getImageData(0, rowNumber * TILE_HEIGHT, image.width, TILE_HEIGHT);

    // Prepare loading queue
    tileLoadQueue[rowNumber] = [];

    // Pass data to get tiles colors
    if (!CAN_USE_WORKER)
      getTilesColorsFromRow(imageData.data, TILE_WIDTH, image.width, TILE_HEIGHT,
        tilesDidSuccessHandler, tilesDidErrorHandler, tilesDidProgressHandler);
    else
      getTilesColorsFromRowWorker(imageData.data, TILE_WIDTH, image.width, TILE_HEIGHT);
  }

  /**
   * @param {number} rowNumber
   */
  function renderTilesRow(rowNumber) {
    var tilesRow = tileLoadQueue[rowNumber], rowString = '';

    for (var i = 0, len = tilesRow.length; i < len; ++i) {
      rowString += tilesRow[i].data;
    }

    document.querySelector(OUTPUT_SELECTOR).innerHTML += rowString;
  }

  // ----------
  // Binding events

  function bindEvents() {
    document.querySelector(INPUT_SELECTOR).addEventListener('change', fileSelectedHandler, false);
    document.querySelector(BUTTON_SELECTOR).addEventListener('click', selectFileHandler, false);

    // DragNDrop
    document.querySelector(CONTAINER_SELECTOR).addEventListener('dragover', dragOverHandler, false);
    document.querySelector(CONTAINER_SELECTOR).addEventListener('dragleave', dragLeaveHandler, false);
    document.querySelector(CONTAINER_SELECTOR).addEventListener('drop', dropHandler, false);
    document.querySelector(SELECTOR_SELECTOR).addEventListener('dragover', dragOverHandler, false);
    document.querySelector(SELECTOR_SELECTOR).addEventListener('dragleave', dragLeaveHandler, false);
    document.querySelector(SELECTOR_SELECTOR).addEventListener('drop', dropHandler, false);

    if (CAN_USE_WORKER) tileWorker.onmessage = tileWorkerResponseHandler;
  }

  // ----------
  // Event handlers

  function fileSelectedHandler(e) {
    e.preventDefault();
    try {
      processFile(e.target.files[0]);
    } catch (e) {
      alert(e);
    }
  }

  function selectFileHandler(e) {
    e.preventDefault();
    fireEvent('click', document.querySelector(INPUT_SELECTOR));
  }

  function tilesDidSuccessHandler(data) {
    // Save sampled data
    tilesColorArray.push(data);

    // Schedule next sample if available
    if (tilesColorArray.length <= totalRows - 1)
      setTimeout(processTilesRow.bind(null, tilesColorArray.length, image, ctx), SAMPLING_TIMEOUT);
    else
      tilesDidCompleteHandler();

    updatePercentage((tilesColorArray.length / totalRows) * 100);
  }

  function tilesDidErrorHandler(error) {
    alert(error);
    tilesDidCompleteHandler();
  }

  function tilesDidCompleteHandler() {
    updateIdle(true);
    console.log(tilesColorArray);
  }

  function tilesDidProgressHandler(data) {
    var currentRow = tilesColorArray.length;
    var isLastRow = currentRow === totalRows;
    var currentRowQueue = tileLoadQueue[currentRow] || (tileLoadQueue[currentRow] = []);
    var currentColQueue = currentRowQueue[currentRowQueue.length] = {};
    columnsLoaded[currentRow] = columnsLoaded[currentRow] || 1;

    currentColQueue.color = data;
    currentColQueue.data = null;
    currentColQueue.promise = loadGetRequest('/color/' + rgbToHex(data[0], data[1], data[2])).then(function (data) {
      currentColQueue.data = data;

      // Check if current col loaded
      if (++columnsLoaded[currentRow] === totalCols) {
        renderTilesRow(currentRow);

        // Check if all cols loaded
        if (isLastRow) tilesDidLoadedHandler();
      }
    });
  }

  function tilesDidLoadedHandler() {
    console.log('All tiles loaded');
  }

  function tileWorkerResponseHandler(e) {
    var data = e.data;

    switch (data.type) {
      case 'onSuccess':
        tilesDidSuccessHandler(data.data);
        break;
      case 'onError':
        tilesDidErrorHandler(data.data);
        break;
      case 'onProgress':
        tilesDidProgressHandler(data.data);
        break;
      default:
        console.error('Unknown response from tile worker: ' + data.type);
        break;
    }
  }

  function dragOverHandler(e) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelector(CONTAINER_SELECTOR).classList.add('dragover');
  }

  function dragLeaveHandler(e) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelector(CONTAINER_SELECTOR).classList.remove('dragover');
  }

  function dropHandler(e) {
    dragLeaveHandler(e);
    var files = e.target.files || e.dataTransfer.files;
    try {
      processFile(files[0]);
    } catch (e) {
      alert(e);
    }
  }

  // ----------
  // Helper functions

  function updateIdle(idle) {
    isIdle = idle;

    // Update view
    if (!isIdle) {
      document.querySelector(PROCESS_SELECTOR).classList.remove('not-visible');
      document.querySelector(OUTPUT_SELECTOR).classList.remove('not-visible');
      document.querySelector(SELECTOR_SELECTOR).classList.add('not-visible');
    } else {
      document.querySelector(PROCESS_SELECTOR).classList.add('not-visible');
    }
  }

  function updatePercentage(percent) {
    document.querySelector(PROGRESS_SELECTOR).style.width = percent + '%';
  }

  function fileToUrl(file) {
    return URL.createObjectURL(file);
  }

  function fileToImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * @param {Image} image
   * @return {CanvasRenderingContext2D}
   */
  function drawImageToCtx(image) {
    ctx.canvas.width = image.width;
    ctx.canvas.height = image.height;
    ctx.drawImage(image, 0, 0);
    return ctx;
  }

  function fireEvent(eventType, element) {
    var event; // The custom event that will be created

    if (document.createEvent) {
      event = document.createEvent("HTMLEvents");
      event.initEvent(eventType, true, true);
    } else {
      event = document.createEventObject();
      event.eventType = eventType;
    }

    event.eventName = eventType;

    if (document.createEvent) {
      element.dispatchEvent(event);
    } else {
      element.fireEvent("on" + event.eventType, event);
    }
  }

  function getTilesColorsFromRowWorker(imgUrl, tileW, width, height) {
    tileWorker.postMessage({
      imgUrl: imgUrl,
      tileW: tileW,
      width: width,
      height: height
    });
  }

  function loadGetRequest(url) {
    return new Promise(function (resolve, reject) {
      if (cachedUrls[url]) {
        resolve(cachedUrls[url]); // Cache hit
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        cachedUrls[url] = xhr.responseText; // Cache before returning
        resolve(xhr.responseText);
      };
      xhr.onerror = reject;
      xhr.open('GET', url);
      xhr.send();
    });
  }

  function rgbToHex(r, g, b) {
    return componentToHex(r) + componentToHex(g) + componentToHex(b);
  }

  function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
  }

  // Startup app
  document.addEventListener('DOMContentLoaded', main, false);

})();
