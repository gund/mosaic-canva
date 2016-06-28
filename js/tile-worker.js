/**
 * Created by alex on 6/28/16.
 */

(function () {
  "use strict";

  var SAMPLING_TIMEOUT = 1;

  // Detect worker env
  var WORKER_ENV = 'importScripts' in self;

  if (WORKER_ENV) {
    // Create bridge for worker interface
    self.addEventListener('message', function (e) {
      var params = e.data;
      getTilesColorsFromRow(params.imgUrl, params.tileW, params.width, params.height,
        notify.bind(null, 'onSuccess'), notify.bind(null, 'onError'), notify.bind(null, 'onProgress'));
    });
  } else {
    // Or expose API globally
    window.getTilesColorsFromRow = getTilesColorsFromRow;
  }

  /**
   * Get tiles colors from image url
   * @param {CanvasPixelArray} imgData
   * @param {number} tileW
   * @param {number} width
   * @param {number} height
   * @param {function=} onSuccess
   * @param {function=} onError
   * @param {function=} onProgress
   */
  function getTilesColorsFromRow(imgData, tileW, width, height, onSuccess, onError, onProgress) {
    tileW = parseInt(tileW);
    width = parseInt(width);
    height = parseInt(height);
    onSuccess = onSuccess || noop;
    onError = onError || noop;
    onProgress = onProgress || noop;

    if (!imgData) {
      onError('Invalid image data');
      return;
    }

    if (isNaN(tileW) || isNaN(width) || isNaN(height)) {
      onError('Invalid tileW/width/height');
      return;
    }

    var offset = 0
      , cols = Math.ceil(width / tileW)
      , skipOffset = (width - tileW) * 4
      , tileLength = tileW * height * 4
      , processedTiles = []
      , i = 0;

    // Iterate by each first pixel in tile
    (function process() {
      if (i < cols - 1) {
        offset = i * tileW;

        // Collect all pixels for tile
        var y = 0, tilePixels = [];
        for (var j = offset; j < tileLength; j += 4) {
          tilePixels.push([
            imgData[offset + tileW * i * 2 + j],
            imgData[offset + tileW * i * 2 + j + 1],
            imgData[offset + tileW * i * 2 + j + 2],
            imgData[offset + tileW * i * 2 + j + 3]
          ]);

          // Track each new row and add offset
          if (++y === tileW) {
            y = 0;
            offset += skipOffset;
          }
        }

        // Sample tile and save
        try {
          var sampledTile = sampleTileData(tilePixels);
        } catch (e) {
          onError('' + e);
          return;
        }
        processedTiles.push(sampledTile);
        onProgress(sampledTile);
        ++i;

        // Go next but not so fast
        setTimeout(process, SAMPLING_TIMEOUT);
      } else {
        // All done
        onSuccess(processedTiles);
      }
    })();
  }

  function sampleTileData(tileData) {
    var rgb = [0, 0, 0]
      , i = -4
      , count = 0
      , length = tileData.length;

    while ((i += 4) < length) {
      if (tileData[i][0] !== 0 && tileData[i][1] !== 0 && tileData[i][2] !== 0) {
        ++count;
        rgb[0] += tileData[i][0];
        rgb[1] += tileData[i][1];
        rgb[2] += tileData[i][2];
      }
    }

    rgb[0] = (rgb[0] / count)|0;
    rgb[1] = (rgb[1] / count)|0;
    rgb[2] = (rgb[2] / count)|0;

    return rgb;
  }

  // ----------
  // Helpers

  function noop() {
  }

  function notify(type, data) {
    self.postMessage({
      type: type,
      data: data
    });
  }

})();