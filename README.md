Description
===========

node-nntp is an NNTP (usenet/newsgroups) client module for [node.js](http://nodejs.org/).


Requirements
============

* [node.js](http://nodejs.org/) -- v0.8.0 or newer


Examples
========

* Get the headers and body of the first message in 'misc.test'

```javascript
    var NNTP = require('nntp'),
        inspect = require('util').inspect;

    var c = new NNTP();
    c.on('ready', function() {
      c.group('misc.test', function(err, count, low, high) {
        if (err) throw err;
      });
      c.article(function(err, n, id, headers, body) {
        if (err) throw err;
        console.log('Article #' + n);
        console.log('Article ID: ' + id);
        console.log('Article headers: ' + inspect(headers));
        console.log('Article body: ' + inspect(body.toString()));
      });
    });
    c.on('error', function(err) {
      console.log('Error: ' + err);
    });
    c.on('close', function(had_err) {
      console.log('Connection closed');
    });
    c.connect({
      host: 'example.org',
      user: 'foo',
      password: 'bar'
    });
```

* Get a list of all newsgroups beginning with 'alt.binaries.'

```javascript
    var NNTP = require('nntp'),
        inspect = require('util').inspect;

    var c = new NNTP();
    c.on('ready', function() {
      c.groups('alt.binaries.*', function(err, list) {
        if (err) throw err;
        console.dir(list);
      });
    });
    c.on('error', function(err) {
      console.log('Error: ' + err);
    });
    c.on('close', function(had_err) {
      console.log('Connection closed');
    });
    c.connect({
      host: 'example.org',
      user: 'foo',
      password: 'bar'
    });
```

* Post a message to alt.test:

```javascript
    var NNTP = require('nntp'),
        inspect = require('util').inspect;

    var c = new NNTP();
    c.on('ready', function() {
      var msg = {
        from: { name: 'Node User', email: 'user@example.com' },
        groups: 'alt.test',
        subject: 'Just testing, do not mind me',
        body: 'node.js rules!'
      };
      c.post(msg, function(err) {
        if (err) throw err;
      });
    });
    c.on('error', function(err) {
      console.log('Error: ' + err);
    });
    c.on('close', function(had_err) {
      console.log('Connection closed');
    });
    c.connect({
      host: 'example.org',
      user: 'foo',
      password: 'bar'
    });
```


API
===

Events
------

* **ready**() - Emitted when connection and authentication were successful.

* **close**(< _boolean_ >hadErr) - Emitted when the connection has fully closed.

* **end**() - Emitted when the connection has ended.

* **error**(< _Error_ >err) - Emitted when an error occurs. In case of protocol-level errors, `err` contains a 'code' property that references the related NNTP response code.


Methods
-------

* **(constructor)**() - Creates and returns a new NNTP client instance.

* **connect**(< _object_ >config) - _(void)_ - Attempts to connect to a server. Valid `config` properties are:

    * **host** - < _string_ > - Hostname or IP address of the server. **Default:** 'localhost'

    * **port** - < _integer_ > - Port number of the server. **Default:** 119

    * **secure** - < _boolean_ > - Will this be a secure (TLS) connection? **Default:** false

    * **user** - < _string_ > - Username for authentication. **Default:** (none)

    * **password** - < _string_ > - Password for password-based user authentication. **Default:** (none)

    * **connTimeout** - < _integer_ > - Connection timeout in milliseconds. **Default:** 60000

* **end**() - _(void)_ - Ends the connection with the server.

### Mandatory/Common protocol commands

* **dateTime**(< _function_ >callback) - _(void)_ - Retrieves the server's UTC date and time in YYYYMMDDHHMMSS format. `callback` has 2 parameters: < _Error_ >err, < _string_ >datetime.

* **stat**([< _string_ >which, ]< _function_ >callback) - _(void)_ - Retrieves the article number and message ID for the current article if `which` is not given or for the article whose number or message ID is `what`. `callback` has 3 parameters: < _Error_ >err, < _integer_ >articleNum, < _string_ >msgID.

* **group**(< _string_ >group, < _function_ >callback) - _(void)_ - Sets the current newsgroup to `group`. `callback` has 4 parameters: < _Error_ >err, < _integer_ >estimatedArticleCount, < _integer_ >firstArticleNum, < _integer_ >lastArticleNum.

* **next**(< _function_ >callback) - _(void)_ - Attempts to move to the next article in the current newsgroup. `callback` has 3 parameters: < _Error_ >err, < _integer_ >articleNum, < _string_ >msgID.

* **prev**(< _function_ >callback) - _(void)_ - Attempts to move to the previous article in the current newsgroup. `callback` has 3 parameters: < _Error_ >err, < _integer_ >articleNum, < _string_ >msgID.

* **headers**([< _string_ >which, ]< _function_ >callback) - _(void)_ - Retrieves the headers of the current article if `which` is not given or for the article whose number or message ID is `what`. `callback` has 4 parameters: < _Error_ >err, < _integer_ >articleNum, < _string_ >msgID, < _object_ >headers. `headers` values are always arrays (of strings).

* **body**([< _string_ >which, ]< _function_ >callback) - _(void)_ - Retrieves the body of the current article if `which` is not given or for the article whose number or message ID is `what`. `callback` has 4 parameters: < _Error_ >err, < _integer_ >articleNum, < _string_ >msgID, < _Buffer_ >body.

* **article**([< _string_ >which, ]< _function_ >callback) - _(void)_ - Retrieves the headers and body of the current article if `which` is not given or for the article whose number or message ID is `what`. `callback` has 5 parameters: < _Error_ >err, < _integer_ >articleNum, < _string_ >msgID, < _object_ >headers, < _Buffer_ >body. `headers` values are always arrays (of strings).

### Extended protocol commands -- these _may not_ be implemented or enabled on all servers

**\* Note: A `filter` parameter is a single (or Array of) wildcard-capable newsgroup name filter string(s) ([information on the wildcard format](http://tools.ietf.org/html/rfc3977#section-4.2) and [wildcard examples](http://tools.ietf.org/html/rfc3977#section-4.4)).**

* **newNews**(< _mixed_ >filter, < _mixed_ >date, [< _string_ >time, ] < _function_ >callback) - _(void)_ - Retrieves the message ID of articles in group(s) matching `filter` on or after a date. This date can be specified with `date` being a Date object, or `date` being a 'YYYYMMDD'-formatted string and `time` being a 'HHMMSS'-formatted string (defaults to midnight) in UTC/GMT. `callback` has 2 parameters: < _Error_ >err, < _array_ >msgIDs.

* **groups**(< _mixed_ >filter, < _function_ >callback) - _(void)_ - Retrieves a list of groups matching `filter`. `callback` has 2 parameters: < _Error_ >err, < _array_ >groupsInfo. `groupsInfo` is an array of `[groupName, firstArticleNum, lastArticleNum, status]` rows. Valid statuses are documented [here](http://tools.ietf.org/html/rfc6048#section-3.1).

* **groupsDesc**(< _mixed_ >filter, < _function_ >callback) - _(void)_ - Retrieves a list of group descriptions matching `filter`. `callback` has 2 parameters: < _Error_ >err, < _array_ >groups. `groups` is an array of `[groupName, groupDesc]` rows.

* **post**(< _object_ >msg, < _function_ >callback) - _(void)_ - Posts the given `msg` (as defined below) to the current newsgroup. `callback` has 1 parameter: < _Error_ >err.

    * **from** - < _object_ > - Who the message is from.
    
        * **name** - < _string_ > - Example: 'User'.
        
        * **email** - < _string_ > - Example: 'user@example.com'.

    * **groups** - < _mixed_ > - A single newsgroup or array of newsgroups to post this message to.

    * **subject** - < _string_ > - The subject line.

    * **body** - < _mixed_ > - The body content -- a string or a Buffer (will be converted to UTF-8 string).



* For methods that return first and last article numbers, the RFC says a group is empty if one of the following is true:

    * The last article number will be one less than the first article number, and
      the estimated article count will be zero. This is the only time that the
      last article number can be less than the first article number.

    * First and last article numbers (and estimated article count where applicable) are all 0.

    * The last article number is equal to the first article number. The
      estimated article count might be zero or non-zero.
