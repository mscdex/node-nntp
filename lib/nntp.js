/*
 *  TODO: - keepalive timer (< 3 min intervals)
 */

var tls = require('tls'),
    Socket = require('net').Socket,
    EventEmitter = require('events').EventEmitter,
    Stream = require('stream'),
    util = require('util'),
    SBMH = require('streamsearch'),
    inherits = util.inherits,
    inspect = util.inspect,
    RE_CRLF = /\r\n/g,
    RE_LIST_ACTIVE = /^(.+)\s+(\d+)\s+(\d+)\s+(.+)$/,
    RE_GROUP_DESC = /^([^\s]+)\s+(.+)$/,
    RE_STAT = /^(\d+)\s+(.+)$/,
    RE_GROUP = /^(\d+)\s+(\d+)\s+(\d+)\s/,
    RE_HDR = /^([^:]+):[ \t]?(.+)?$/,
    RES_CODE_ML = [100, 101, 215, 220, 221, 222, 224, 225, 230, 231],
    RES_CODE_ARGS = [111, 211, 220, 221, 222, 223, 401],
    B_CRLF = new Buffer([13, 10]),
    B_ML_TERM = new Buffer([13, 10, 46, 13, 10]),
    TYPE = {
      CONNECTION: 0,
      GROUP: 1,
      ARTICLE: 2,
      DISTRIBUTION: 3,
      POST: 4,
      AUTH: 8,
      PRIVATE: 9
    },
    RETVAL = {
      INFO: 1,
      OK: 2,
      WAITING: 3,
      ERR_NONSYN: 4,
      ERR_OTHER: 5
    },
    ERRORS = {
      400: 'Service not available or no longer available',
      401: 'Server is in the wrong mode',
      403: 'Internal fault',
      411: 'No such newsgroup',
      412: 'No newsgroup selected',
      420: 'Current article number is invalid',
      421: 'No next article in this group',
      422: 'No previous article in this group',
      423: 'No article with that number or in that range',
      430: 'No article with that message-id',
      435: 'Article not wanted',
      436: 'Transfer not possible or failed; try again later',
      437: 'Transfer rejected; do not retry',
      440: 'Posting not permitted',
      441: 'Posting failed',
      480: 'Authentication required',
      481: 'Authentication failed/rejected', // RFC 4643
      483: 'Command unavailable until suitable privacy has been arranged',
      500: 'Unknown command',
      501: 'Syntax error',
      502: 'Service/command not permitted',
      503: 'Feature not supported',
      504: 'Invalid base64-encoded argument'
    };

function NNTP() {
  this._sbmhML = new SBMH(B_ML_TERM);
  this._sbmhML.maxMatches = 1;
  this._sbmhCRLF = new SBMH(B_CRLF);
  this._sbmhCRLF.maxMatches = 1;

  this._socket = undefined;
  this._state = undefined;
  this._caps = undefined;
  this._queue = undefined;
  this._curReq = undefined;
  this._stream = undefined;
  this._buffer = '';
  this._bufferEnc = undefined;
  this._debug = false;
  this.options = {
    host: undefined,
    port: undefined,
    secure: undefined,
    user: undefined,
    password: undefined,
    connTimeout: undefined
  };
  this.connected = false;
}
inherits(NNTP, EventEmitter);

NNTP.prototype.reset = function() {
  this._sbmhML.reset();
  this._sbmhCRLF.reset();
  this._socket = undefined;
  this._state = undefined;
  this._caps = undefined;
  this._queue = undefined;
  this._curReq = undefined;
  this._stream = undefined;
  this._buffer = '';
  this._bufferEnc = undefined;
  this.connected = false;
};

function readCode(chunk, code) {
  var ret = code, more,
      left = chunk.length - chunk.p;
  if (left >= 3 && code === undefined) {
    ret = parseInt(chunk.toString('ascii', chunk.p, chunk.p + 3), 10);
    chunk.p += 3;
  } else {
    if (code === undefined) {
      ret = chunk.toString('ascii', chunk.p);
      chunk.p = chunk.length;
    } else {
      more = 3 - ret.length;
      if (left >= more) {
        ret += chunk.toString('ascii', chunk.p, chunk.p + more);
        chunk.p += more;
      } else {
        ret += chunk.toString('ascii', chunk.p);
        chunk.p = chunk.length;
      }

      if (ret.length === 3)
        ret = parseInt(ret, 10);
    }
  }
  return ret;
}

NNTP.prototype.connect = function(options) {
  var self = this;

  this.options.host = options.host || 'localhost';
  this.options.port = options.port || 119;
  this.options.secure = options.secure || false;
  this.options.user = options.user || '';
  this.options.password = options.password || '';
  this.options.connTimeout = options.connTimeout || 60000; // in ms
  var debug;
  if (typeof options.debug === 'function')
    debug = this._debug = options.debug;
  else
    debug = this._debug = false;

  this.reset();
  this._caps = {};
  this._queue = [];
  this._state = 'connecting';
  this.connected = false;

  var isML = false, code, type, retval, isErr, sbmh;

  var connTimeout = setTimeout(function() {
    self._socket.destroy();
    self._socket = undefined;
    self.emit('error', new Error('Connection timeout'));
  }, this.options.connTimeout);

  var socket = this._socket = new Socket();
  this._socket.setTimeout(0);
  if (this.options.secure)
    socket = tls.connect({ socket: this._socket }, onconnect);
  else
    this._socket.once('connect', onconnect);
  function onconnect() {
    self._socket = socket; // re-assign for secure connections
    self._state = 'connected';
    self.connected = true;
    clearTimeout(connTimeout);
    
    var cmd, params;
    self._curReq = {
      cmd: '',
      cb: function reentry(err, code) {
        // many? servers don't support the *mandatory* CAPABILITIES command :-(
        if (err && cmd !== 'CAPABILITIES') {
          self.emit('error', err);
          return self._socket.end();
        }
        // TODO: try sending CAPABILITIES first thing
        if (!cmd) {
          if (self.options.user) {
            cmd = 'AUTHINFO';
            params = 'USER ' + self.options.user;
          } else {
            cmd = 'CAPABILITIES';
            params = undefined;
          }
        } else if (cmd === 'AUTHINFO') {
          if (params.substr(0, 4) === 'USER') {
            if (code === 381) { // password required
              if (!self.options.password) {
                self.emit('error', makeError('Password required', code));
                return self._socket.end();
              }
              params = 'PASS ' + self.options.password;
            }
          } else if (params.substr(0, 4) === 'PASS') {
            cmd = 'CAPABILITIES';
            params = undefined;
          }
        } else if (cmd === 'CAPABILITIES') {
          //self._parseCaps();
          return self.emit('ready');
        }
        self._send(cmd, params, reentry);
      }
    };
  }
  this._socket.once('end', function() {
    clearTimeout(connTimeout);
    self.connected = false;
    self._state = 'disconnected';
    self.emit('end');
  });
  this._socket.once('close', function(had_err) {
    clearTimeout(connTimeout);
    self.connected = false;
    self._state = 'disconnected';
    self.emit('close', had_err);
  });
  this._socket.once('error', function(err) {
    self.emit('error', err);
  });
  socket.on('data', function(chunk) {
    chunk.p = 0;
    var chlen = chunk.length, r = 0;
    debug&&debug('< ' + inspect(chunk.toString('binary')));
    while (r < chlen) {
      if (typeof code !== 'number') {
        code = readCode(chunk, code);
        if (typeof code !== 'number')
          return;
        if (isNaN(code)) {
          self.reset();
          self.emit('error', new Error('Parse error'));
          return socket.end();
        }
        retval = code / 100 >> 0;
        type = (code % 100) / 10 >> 0;
        isErr = (retval === RETVAL.ERR_NONSYN || retval === RETVAL.ERR_OTHER);
        if (code === 211)
          isML = (self._curReq.cmd !== 'GROUP');
        else
          isML = (RES_CODE_ML.indexOf(code) > -1);
        sbmh = (isML ? self._sbmhML : self._sbmhCRLF);
        sbmh.reset();
        r = chunk.p;
      } else {
        r = sbmh.push(chunk, r);

        if (sbmh.matches === 1) {
          if (self._stream) {
            if (isErr)
              self._stream.emit('error', makeError(ERRORS[code], code));
            else
              self._stream.emit('end');
            self._stream.emit('close', isErr);
          } else if (isErr)
            self._curReq.cb(makeError(ERRORS[code], code));
          else {
            self._curReq.cb(undefined, code, retval, type);
            self._buffer = '';
          }
          code = undefined;
          self._curReq = undefined;
          self._send();
        }
      }
    }
  });

  function responseHandler(isMatch, chunk, start, end) {
    if (isErr || !chunk)
      return;
    if (self._stream === undefined)
      self._buffer += chunk.toString(self._bufferEnc || 'utf8', start, end);
    else
      self._stream.emit('data', chunk.slice(start, end));
  }
  this._sbmhML.on('info', responseHandler);
  this._sbmhCRLF.on('info', responseHandler);

  this._socket.connect(this.options.port, this.options.host);
};

NNTP.prototype.end = function() {
  if (this._socket && this._socket.writable)
    this._socket.end();

  this._socket = undefined;
};


// Mandatory/Common features
NNTP.prototype.dateTime = function(cb) {
  var self = this;
  this._send('DATE', undefined, function(err, code, r, type) {
    if (err)
      return cb(err);
    // server UTC date/time in YYYYMMDDHHMMSS format
    cb(undefined, self._buffer.trim());
  });
};

NNTP.prototype.stat = function(id, cb) {
  var self = this;
  if (typeof id === 'function') {
    cb = id;
    id = undefined;
  }
  this._send('STAT', id, function(err, code, r, type) {
    if (err)
      return cb(err);
    var m = RE_STAT.exec(self._buffer.trim());
    // article number, message id
    cb(undefined, parseInt(m[1], 10), m[2]);
  });
};

NNTP.prototype.group = function(group, cb) {
  var self = this;
  this._send('GROUP', group, function(err, code, r, type) {
    if (err)
      return cb(err);

    // est. article count, low mark, high mark
    var m = RE_GROUP.exec(self._buffer.trim());
    cb(undefined, parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  });
};

NNTP.prototype.next = function(cb) {
  var self = this;
  this._send('NEXT', undefined, function(err, code, r, type) {
    if (err)
      return cb(err);
    var m = RE_STAT.exec(self._buffer.trim());
    // article number, message id
    cb(undefined, parseInt(m[1], 10), m[2]);
  });
};

NNTP.prototype.prev = function(cb) {
  var self = this;
  this._send('LAST', undefined, function(err, code, r, type) {
    if (err)
      return cb(err);
    var m = RE_STAT.exec(self._buffer.trim());
    // article number, message id
    cb(undefined, parseInt(m[1], 10), m[2]);
  });
};

NNTP.prototype.headers = function(what, cb) {
  var self = this;

  if (typeof what === 'function') {
    cb = what;
    what = undefined;
  }

  this._send('HEAD', what, function(err, code, r, type) {
    if (err)
      return cb(err);

    var list = self._buffer.split(RE_CRLF),
        info = list.shift().trim(),
        headers = {}, m;

    for (var i = 0, h, len = list.length; i < len; ++i) {
      if (list[i].length === 0)
        continue;
      if (list[i][0] === '\t' || list[i][0] === ' ') {
        // folded header content
        // RFC2822 says to just remove the CRLF and not the whitespace following
        // it, so we follow the RFC and include the leading whitespace ...
        headers[h][headers[h].length - 1] += list[i];
      } else {
        m = RE_HDR.exec(list[i]);
        h = m[1].toLowerCase();
        if (m[2]) {
          if (headers[h] === undefined)
            headers[h] = [m[2]];
          else
            headers[h].push(m[2]);
        } else
          headers[h] = '';
      }
    }

    m = RE_STAT.exec(info);
    // article number, message id, headers
    cb(undefined, parseInt(m[1], 10), m[2], headers);
  });
};

NNTP.prototype.body = function(what, cb) {
  var self = this;

  /*if (typeof what === 'function') {
    // body(function() {})
    cb = what;
    doBuffer = false;
    what = undefined;
  } else if (typeof doBuffer === 'function') {
    cb = doBuffer;
    if (typeof what === 'boolean') {
      // body(true, function() {});
      doBuffer = what;
      what = undefined;
    } else {
      // body(100, function() {});
      doBuffer = false;
    }
  }*/

  if (typeof what === 'function') {
    cb = what;
    what = undefined;
  }

  this._bufferEnc = 'binary';

  this._send('BODY', what, function(err, code, r, type) {
    self._bufferEnc = undefined;
    if (err)
      return cb(err);

    var idxCRLF = self._buffer.indexOf('\r\n'), m, body = '';

    if (idxCRLF > -1) {
      body = self._buffer.substring(idxCRLF + 2);
      m = RE_STAT.exec(self._buffer.substring(0, idxCRLF).trim());
    } else {
      // empty body
      m = RE_STAT.exec(self._buffer.trim());
    }

    body = new Buffer(body, 'binary');

    // article number, message id, string body
    cb(undefined, parseInt(m[1], 10), m[2], body);
  });
};

NNTP.prototype.article = function(what, cb) {
  var self = this;

  /*if (typeof what === 'function') {
    // body(function() {})
    cb = what;
    doBuffer = false;
    what = undefined;
  } else if (typeof doBuffer === 'function') {
    cb = doBuffer;
    if (typeof what === 'boolean') {
      // body(true, function() {});
      doBuffer = what;
      what = undefined;
    } else {
      // body(100, function() {});
      doBuffer = false;
    }
  }*/

  if (typeof what === 'function') {
    cb = what;
    what = undefined;
  }

  this._bufferEnc = 'binary';

  this._send('ARTICLE', what, function(err, code, r, type) {
    self._bufferEnc = undefined;
    if (err)
      return cb(err);

    var idxDCRLF = self._buffer.indexOf('\r\n\r\n'), m, list,
        headers = {}, body, info, sheaders;

    sheaders = self._buffer.substring(0, idxDCRLF);
    list = sheaders.split(RE_CRLF);
    info = list.shift().trim();
    for (var i = 0, h, len = list.length; i < len; ++i) {
      if (list[i].length === 0)
        continue;
      if (list[i][0] === '\t' || list[i][0] === ' ') {
        // folded header content
        // RFC2822 says to just remove the CRLF and not the whitespace following
        // it, so we follow the RFC and include the leading whitespace ...
        headers[h][headers[h].length - 1] += list[i];
      } else {
        m = RE_HDR.exec(list[i]);
        h = m[1].toLowerCase();
        if (m[2]) {
          if (headers[h] === undefined)
            headers[h] = [m[2]];
          else
            headers[h].push(m[2]);
        } else
          headers[h] = '';
      }
    }

    body = new Buffer(self._buffer.substring(idxDCRLF + 4), 'binary');

    m = RE_STAT.exec(info);

    // article number, message id, headers, string body
    cb(undefined, parseInt(m[1], 10), m[2], headers, body);
  });
};


// Extended features -- these may not be implemented or enabled on all servers
NNTP.prototype.newNews = function(search, date8, time6, cb) {
  if (typeof search !== 'string')
    throw new Error('Expected search string');
  /*if (typeof date8 === 'function'
      || (typeof time6 === 'function' && !util.isDate(date8)))
    throw new Error('Expected Date instance');*/

  var self = this;

  if (typeof time6 === 'function') {
    cb = time6;
    if (util.isDate(date8)) {
      time6 = padLeft(''+date8.getUTCHours(), 2, '0')
              + padLeft(''+date8.getUTCMinutes(), 2, '0')
              + padLeft(''+date8.getUTCSeconds(), 2, '0');
      date8 = ''+date8.getUTCFullYear()
              + padLeft(''+date8.getUTCMonth(), 2, '0')
              + padLeft(''+date8.getUTCDate(), 2, '0');
    } else
      time6 = '000000';
  }

  if (Array.isArray(search))
    search = search.join(',');
  search = (search ? search : '');

  this._send('NEWNEWS', search + ' ' + date8 + ' ' + time6 + ' GMT',
    function(err, code, r, type) {
      if (err)
        return cb(err);
      var list = self._buffer.split(RE_CRLF);
      list.shift(); // remove initial response line
      cb(undefined, list);
    }
  );
};

NNTP.prototype.groups = function(search, cb) {
  var self = this;
  if (typeof search === 'function') {
    cb = search;
    search = '';
  }
  if (Array.isArray(search))
    search = search.join(',');
  search = (search ? ' ' + search : '');
  this._send('LIST', 'ACTIVE' + search, function(err, code, r, type) {
    if (err)
      return cb(err);
    var list = self._buffer.split(RE_CRLF);
    list.shift(); // remove initial response line
    for (var i = 0, m, len = list.length; i < len; ++i) {
      m = RE_LIST_ACTIVE.exec(list[i]);
      // short name, low mark, high mark, status
      list[i] = [ m[1], parseInt(m[3], 10), parseInt(m[2], 10), m[4] ];
    }
    cb(undefined, list);
  });
};

NNTP.prototype.groupsDesc = function(search, cb) {
  var self = this;
  if (typeof search === 'function') {
    cb = search;
    search = '';
  } else if (Array.isArray(search))
    search = search.join(',');
  search = (search ? ' ' + search : '');

  // According to the RFC:
  //   The description SHOULD be in UTF-8. However, servers often obtain the
  //   information from external sources. These sources may have used different
  //   encodings (ones that use octets in the range 128 to 255 in some other
  //   manner) and, in that case, the server MAY pass it on unchanged.
  //   Therefore, clients MUST be prepared to receive such descriptions.
  this._bufferEnc = 'binary';

  this._send('LIST', 'NEWSGROUPS' + search, function(err, code, r, type) {
    self._bufferEnc = undefined;
    if (err)
      return cb(err);
    var list = self._buffer.split(RE_CRLF);
    list.shift(); // remove initial response line
    for (var i = 0, m, len = list.length; i < len; ++i) {
      m = RE_GROUP_DESC.exec(list[i]);
      // short name, description
      list[i] = [ m[1], m[2] ];
    }
    cb(undefined, list);
  });
};

NNTP.prototype.post = function(msg, cb) {
  var self = this, composing = true;
  this._send('POST', function reentry(err, code, r, type) {
    if (err || !composing)
      return cb(err);

    var CRLF = '\r\n',
        text;

    text = 'From: "';
    text += msg.from.name;
    text += '" <';
    text += msg.from.email;
    text += '>';
    text += CRLF;

    text += 'Newsgroups: ';
    text += (Array.isArray(msg.groups) ? msg.groups.join(',') : msg.groups);
    text += CRLF;

    text += 'Subject: ';
    text += msg.subject;
    text += CRLF;

    text += CRLF;

    text += (Buffer.isBuffer(msg.body)
             ? msg.body.toString('utf8')
             : msg.body
            ).replace(/\r\n/g, '\n')
             .replace(/\r/g, '\n')
             .replace(/\n/g, '\r\n')
             .replace(/^\.([^.]*?)/gm, '..$1');

    // _send always appends CRLF to the end of every cmd
    text += '\r\n.';

    composing = false;
    self._send(text, undefined, reentry);
  });
};

// Private methods
NNTP.prototype._send = function(cmd, params, cb) {
  if (cmd !== undefined)
    this._queue.push({ cmd: cmd, params: params, cb: cb });
  if (!this._curReq && this._queue.length) {
    this._curReq = this._queue.shift();
    this._socket.write(this._curReq.cmd);
    if (this._curReq.params !== undefined) {
      if (this._debug) {
        this._debug('> ' + this._curReq.cmd + ' ' + this._curReq.params);
      }
      this._socket.write(' ');
      this._socket.write(''+this._curReq.params);
    } else if (this._debug)
      this._debug('> ' + this._curReq.cmd);
      
    this._socket.write(B_CRLF);
  }
};

NNTP.prototype._parseCaps = function() {
  // TODO
};

module.exports = NNTP;

function padLeft(str, size, pad) {
  var ret = str;
  if (str.length < size) {
    for (var i=0,len=(size-str.length); i<len; ++i)
      ret = pad + ret;
  }
  return ret;
}

function makeError(msg, code) {
  var err = new Error(msg);
  err.code = code;
  return err;
}

function ReadStream(sock) {
  var self = this;
  this.readable = true;
  this.paused = false;
  this._buffer = [];
  this._sock = sock;
  this._decoder = undefined;
  sock.once('end', function() {
    self.readable = false;
  });
  sock.once('close', function(had_err) {
    self.readable = false;
  });
}
inherits(ReadStream, Stream);

ReadStream.prototype._emitData = function(d) {
  if (d === undefined) {
    if (this._buffer && this._buffer.length) {
      this._emitData(this._buffer.shift());
      return true;
    } else
      return false;
  } else if (this.paused)
    this._buffer.push(d);
  else if (this._decoder) {
    var string = this._decoder.write(d);
    if (string.length)
      this.emit('data', string);
  } else
    this.emit('data', d);
};

ReadStream.prototype.pause = function() {
  this.paused = true;
  this._sock.pause();
};

ReadStream.prototype.resume = function() {
  if (this._buffer && this._buffer.length)
    while (this._emitData());
  this.paused = false;
  this._sock.resume();
};

ReadStream.prototype.destroy = function(cb) {
  this._decoder = undefined;

  if (!this.readable) {
    cb && process.nextTick(cb);
    return;
  }

  this.readable = false;
  this._buffer = [];
  cb && cb();
  this.emit('close');
};

ReadStream.prototype.setEncoding = function(encoding) {
  var StringDecoder = require('string_decoder').StringDecoder; // lazy load
  this._decoder = new StringDecoder(encoding);
};
