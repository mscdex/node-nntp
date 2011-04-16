var NNTP = require(__dirname + '/../../../nntp'),
    ydec = require(__dirname + '/ydec'),
    fs = require('fs'),
    inspect = require('util').inspect;

var pathComplete = __dirname + '/../downloads/',
    pathTemp = __dirname + '/../temp/',
    conn, out;

function postError(e) {
  if (conn)
    conn.end();
  if (out)
    out.end();
  conn = undefined;
  postMessage({ event: 'error', err: e });
}

function decodeArticles(ids, index, path, filename) {
  index = index || 0;
  postMessage({ event: 'decode', part: index+1, total: ids.length });
  if (index === 0) {
    path = pathComplete + Date.now();
    fs.mkdirSync(path, '0777');
    path += '/';
  }
  var stream = ydec(fs.createReadStream(pathTemp + ids[index])),
      corrupt = false;
  stream.on('data', function(data) {
    out.write(data);
  });
  if (index === 0) {
    stream.on('ybegin', function(o) {
      filename = o.name;
      out = fs.createWriteStream(path + filename);
    });
  }
  stream.on('yend', function(yend) {
    if (!yend.crcMatches)
      corrupt = true;
  });
  stream.on('end', function() {
    if (!corrupt) {
      fs.unlink(pathTemp + ids[index]);
      if (++index < ids.length)
        process.nextTick(function() { decodeArticles(ids, index, path, filename); });
      else {
        out.end();
        postMessage({ event: 'done', filename: filename });
      }
    } else {
      out.end();
      fs.unlink(path + filename);
      fs.renameSync(pathTemp + ids[index], pathTemp + 'corrupt_' + ids[index]);
      postMessage({ event: 'done', filename: filename, corrupt: true });
    }
  });
}

function grabArticles(ids, index) {
  index = index || 0;
  postMessage({ event: 'transfer', part: index+1, total: ids.length });
  conn.body('<' + ids[index] + '>', function(e, em) {
    if (e) return postError(e);
    var partWriter = fs.createWriteStream(pathTemp + ids[index]);
    em.on('line', function(data) {
      partWriter.write(data);
      partWriter.write('\r\n');
    });
    em.on('end', function() {
      partWriter.end();
      if (++index < ids.length)
        process.nextTick(function() { grabArticles(ids, index); });
      else {
        conn.end();
        conn = undefined;
        process.nextTick(function() { decodeArticles(ids); });
      }
    });
  });
}
function doConnect(m) {
  if (conn)
    conn.end();
  conn = new NNTP(m.data.config);
  conn.on('connect', function cb() {
    if (m.data.auth) {
      conn.auth(m.data.auth.username, m.data.auth.password, function(e) {
        if (e) return postError(e);
        grabArticles(m.data.ids);
      });
    } else
      grabArticles(m.data.ids);
  });
  conn.on('error', function(e) {
    postError(e);
  });
  conn.connect();
}
onerror = function(e) {
  console.dir(e.stack);
};
onmessage = function(m) {
  doConnect(m);
};
onclose = function() {
  if (out)
    out.end();
  if (conn)
    conn.end();
  conn = undefined;
  out = undefined;
};