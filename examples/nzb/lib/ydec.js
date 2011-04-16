var fs = require('fs'), util = require('util'),
    Buffy = require('../../../deps/buffy'),
    Stream = require('stream').Stream;

var CRLF = [13, 10],
    yBegin = [0x3d, 0x79, 0x62, 0x65, 0x67, 0x69, 0x6e, 0x20],
    yEnd = [0x3d, 0x79, 0x65, 0x6e, 0x64, 0x20],
    yPart = [0x3d, 0x79, 0x70, 0x61, 0x72, 0x74, 0x20];

function decode(data) {
  var newBytes = new Array(), escaped = false;
  for (var i=0,len=data.length; i<len; ++i) {
    if (data[i] === 61) {
      // TODO: make sure '=' isn't the last char!
      escaped = true;
    } else {
      if (escaped) {
        newBytes.push(data[i] - 106);
        escaped = false;
      } else
        newBytes.push(data[i] - 42);
    }
  }
  return new Buffer(newBytes);
}

module.exports = function(instream) {
  var outstream = new Stream(), state = 'pre', buffy = new Buffy();
  var meta = {
      begin: {
        size: undefined,
        total: undefined,
        line: undefined,
        name: undefined,
      },
      part: {
        begin: undefined,
        end: undefined
      },
      end: {
        size: undefined,
        part: undefined,
        pcrc32: undefined,
        crc32: undefined
      }
    }, eolPos, startPos = 0, hasProcessed = false, line, r;
  instream.on('data', function(data) {
    buffy.append(data);
    while ((eolPos = buffy.indexOf(CRLF, startPos)) > -1) {
      r = buffy.GCBefore(startPos);
      if (r > 0 && startPos > 0) {
        startPos -= r;
        eolPos -= r;
      }
      hasProcessed = true;
      if (eolPos - startPos > 0) {
        line = new Buffer(eolPos - startPos);
        buffy.copy(line, 0, startPos, eolPos);
        if (state === 'pre' && line.startsWith(yBegin)) {
          var result;
          if (result = line.toString().match(/^=ybegin (.+?) name=(.+)$/)) {
            result[1].split(' ').forEach(function(s) {
              var kv = s.split('=');
              meta.begin[kv[0]] = parseInt(kv[1], 10);
            });
            meta.begin.name = result[2];
            state = 'checkpart';
            outstream.emit('ybegin', meta.begin);
          }
        } else if (state === 'checkpart') {
          state = 'data';
          var isHeader = false;
          if (line.startsWith(yPart)) {
            var result = line.toString().match(/^=ypart (.+?)$/);
            if (result) {
              result[1].split(' ').forEach(function(s) {
                var kv = s.split('=');
                meta.part[kv[0]] = parseInt(kv[1], 10);
              });
              isHeader = true;
              outstream.emit('ypart', meta.part);
            }
          }
          if (!isHeader)
            outstream.emit('data', decode(line));
        } else if (state === 'data') {
          var isHeader = false;
          if (line.startsWith(yEnd)) {
            var result = line.toString().match(/^=yend (.+?)$/);
            if (result) {
              result[1].split(' ').forEach(function(s) {
                var kv = s.split('=');
                meta.end[kv[0]] = (kv[0] === 'part' || kv[0] === 'size'
                                   ? parseInt(kv[1], 10) : kv[1]);
              });
              state = 'pre';
              isHeader = true;
              outstream.emit('yend', meta.end);
            }
          }
          if (!isHeader)
            outstream.emit('data', decode(line));
        }
        line = undefined;
      }
      startPos = eolPos + 2;
    }
    if (hasProcessed) {
      hasProcessed = false;
    }
  });
  instream.on('end', function() {
    // need to check if =yend is still in our buffered data, in case there was
    // no newline at the end of the stream
    if (state === 'data' && startPos < buffy.length) {
      var line = buffy.toString('ascii', startPos),
          result = line.match(/^=yend (.+?)$/);
      if (result) {
        result[1].split(' ').forEach(function(s) {
          var kv = s.split('=');
          meta.end[kv[0]] = (kv[0] === 'part' || kv[0] === 'size'
                             ? parseInt(kv[1], 10) : kv[1]);
        });
        outstream.emit('yend', meta.end);
      }
    }
    hasProcessed = false;
    line = undefined;
    buffy = undefined;
    state = 'pre';
    outstream.emit('end');
  });
  instream.on('close', function() {
    outstream.emit('close');
  });
  return outstream;
};

Buffer.prototype.startsWith = function(subject) {
  var search = (Array.isArray(subject) ? subject : [subject]),
      searchLen = search.length, ret;
  if (ret = (this.length > 0 && searchLen <= this.length)) {
    for (var i=0; i<searchLen; ++i) {
      if (this[i] !== search[i]) {
        ret = false;
        break;
      }
    }
  }
  return ret;
};

Buffer.prototype.indexOf = function(subject, start) {
  var search = (Array.isArray(subject) ? subject : [subject]),
      searchLen = search.length,
      ret = -1, i, j, len;
  for (i=start||0,len=this.length; i<len; ++i) {
    if (this[i] == search[0] && (len-i) >= searchLen) {
      if (searchLen > 1) {
        for (j=1; j<searchLen; ++j) {
          if (this[i+j] != search[j])
            break;
          else if (j == searchLen-1) {
            ret = i;
            break;
          }
        }
      } else
        ret = i;
      if (ret > -1)
        break;
    }
  }
  return ret;
};