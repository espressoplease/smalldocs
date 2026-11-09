const fs = require('fs');
const path = require('path');
const video = fs.readFileSync(path.join(__dirname, '../public/homepage/home-next-demo.mp4'));

// Preserve byte-range requests so browser seeking works as it does on the CDN.
module.exports = function stubDemo(page) {
  return page.route('**/homepage/demo-*.mp4*', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
    if (!range) return route.fulfill({ status: 200, headers, body: video });
    const start = Number(range[1]);
    if (start >= video.length) return route.fulfill({ status: 416,
      headers: { ...headers, 'Content-Range': 'bytes */' + video.length }, body: '' });
    const end = Math.min(range[2] ? Number(range[2]) : video.length - 1, video.length - 1);
    return route.fulfill({ status: 206, headers: { ...headers,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + video.length },
      body: video.subarray(start, end + 1) });
  });
};
