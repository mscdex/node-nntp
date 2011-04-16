var path = require('path'), Worker = require('./deps/webworker').Worker,
    parser = require('./deps/sax').parser(true),
    inspect = require('util').inspect;

var argv = process.argv, argc = argv.length, workers = [];
if (argc < 4)
  usage();
else {
  var host = argv[argc-2], where = argv[argc-1], isStdin, isHTTPS, isHTTP,
      isFile, nzb = '', cbGotNZB;
  if ((!(isStdin = (where === '-'))
        && !(isHTTPS = (where.substring(0,5).toLowerCase() === 'https'))
        && !(isHTTP = (where.substring(0,4).toLowerCase() === 'http'))
        && !(isFile = (path.existsSync(where = path.resolve(where)))))
      || !(host=host.match(/^(.+?)(?:\:(\d+))?$/)))
    usage();

  var config = { host: host[1] }, user, pass, numWorkers = 1;
  if (host[2])
    config['port'] = parseInt(host[2], 10);
  for (var i=2,last=argc-2; i<last; ++i) {
    if (argv[i] === '-s')
      config['secure'] = true;
    else if (argv[i].indexOf('-u') === 0)
      user = argv[i].substring(2);
    else if (argv[i].indexOf('-p') === 0)
      pass = argv[i].substring(2);
    else if (argv[i].indexOf('-n') === 0) {
      try {
        numWorkers = parseInt(argv[i].substring(2), 10);
        if (numWorkers <= 0)
          throw 'Bad value';
      } catch(e) {
        console.error('Invalid number of connections');
        process.exit(4);
      }
    } else {
      console.error('Invalid option: ' + argv[i]);
      process.exit(4);
    }
  }

  cbGotNZB = function(e) {
    if (e) {
      console.error('While retrieving NZB: ' + e);
      process.exit(2);
    }
    if (typeof nzb === 'string')
      return parseNZB(cbGotNZB);
    else if (typeof nzb !== 'object') {
      console.error('Unable to parse NZB');
      process.exit(3);
    }
    numWorkers = Math.min(nzb.file.length, numWorkers);
    for (var i=0; i<numWorkers; ++i) {
      var w = new Worker(__dirname + '/lib/nzb-worker.js');
      w.onerror = function(e) {
        console.error('Worker #' + (workers.indexOf(w)+1) + ' error: ' + inspect(e));
      };
      w.onmessage = function(m) {
        var wnum = workers.indexOf(w)+1;
        if (m.data.event === 'error') {
          console.error('Main :: Got error from worker #'
                        + wnum + ': ' + inspect(m.data.err));
        } else if (m.data.event === 'transfer') {
          console.log('Main :: Worker #' + wnum + ' is downloading part '
                      + m.data.part + '/' + m.data.total + ' ...');
        } else if (m.data.event === 'decode') {
          console.log('Main :: Worker #' + wnum + ' is decoding part '
                      + m.data.part + '/' + m.data.total + ' ...');
        } else if (m.data.event === 'done') {
          console.log('Main :: Worker #' + wnum + ' finished downloading file: '
                      + m.data.filename);
          if (nzb.file.length) {
            var m = { config: config };
            if (user || pass)
              m.auth = { username: user, password: pass };
            m.ids = nzb.file.pop().segments[0].segment.sort(function(a, b) {
              return (parseInt(a['@'].number, 10)) - (parseInt(b['@'].number, 10));
            }).map(function(o) {
              return o['#'];
            });
            w.postMessage(m);
          } else {
            w.terminate();
            workers.splice(wnum-1, 1);
            if (workers.length === 0) {
              console.log('Main :: No more work to be done');
              process.exit(0);
            }
          }
        }
      };
      process.nextTick(function() {
        var m = { config: config };
        if (user || pass)
          m.auth = { username: user, password: pass };
        m.ids = nzb.file.pop().segments[0].segment.sort(function(a, b) {
          return (parseInt(a['@'].number, 10)) - (parseInt(b['@'].number, 10));
        }).map(function(o) {
          return o['#'];
        });
        w.postMessage(m);
      });
      workers.push(w);
      console.log('Main :: Starting worker #' + (i+1) + ' handling '
                  + nzb.file[i].segments[0].segment.length + ' parts ...');
    }
  };
  if (isStdin) {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (chunk) {
      nzb += chunk;
    });
    process.stdin.on('error', cbGotNZB);
    process.stdin.on('end', cbGotNZB);
  } else if (isFile) {
    require('fs').readFile(where, 'utf8', function(e, data) {
      if (!e)
        nzb = data;
      cbGotNZB(e);
    });
  } else if (isHTTP || isHTTPS) {
    var request = (isHTTP ? require('http').request : require('https').request);
    request(function(res) {
      if (res.statusCode === 200) {
        res.on('data', function(chunk) {
          nzb += chunk;
        });
        res.on('error', cbGotNZB);
        res.on('end', cbGotNZB);
      } else
        cbGotNZB(new Error('Got HTTP' + (isHTTPS ? 'S' : '') + ' status code: '
                           + res.statusCode));
    }).on('error', cbGotNZB);
  }
}

function usage() {
  var help = '\nOptions:\n';
  //help += '\t-s\t\tUse TLS\n';
  help += '\t-n<NUMCONNS>\tUse maximum of NUMCONNS connections [Default: 1]\n';
  help += '\t-u<USER>\tAuthenticate with username USER\n';
  help += '\t-p<PASS>\tAuthenticate using password PASS\n';
  console.log('Usage: ' + process.argv[0] + ' ' + path.basename(process.argv[1]) + ' [options] <host[:port]> <URL/path to NZB>');
  console.log(help);
  process.exit(1);
}

function parseNZB(cb) {
  // TODO: setup timeout in case of incomplete XML (e.g. missing root end tag)?
  var stack = [];
  parser.onerror = function (e) {
    console.error('Unable to parse NZB');
    process.exit(3);
  };
  parser.ontext = function (chars) {
    chars = chars.trim();
    if (chars.length)
      stack[stack.length-1]['#'] += chars;
  };
  parser.onopentag = function (node) {
    var obj = {}, attrKeys = Object.keys(node.attributes);
    obj['@'] = {};
    obj['#'] = '';
    for (var i=0,len=attrKeys.length; i<len; ++i)
      obj['@'][attrKeys[i]] = node.attributes[attrKeys[i]];
    stack.push(obj);
  };
  parser.onclosetag = function (elem) {
    var obj = stack.pop();
    if (stack.length > 0) {
      if (typeof stack[stack.length-1][elem] === 'undefined')
        stack[stack.length-1][elem] = new Array(obj);
      else
        stack[stack.length-1][elem].push(obj);
    } else {
      nzb = obj;
      cb();
    }
  };
  parser.write(nzb).close();
}