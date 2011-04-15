Description
===========

node-nntp is an NNTP (usenet/newsgroups/etc) client module for [node.js](http://nodejs.org/).


Requirements
============

* [node.js](http://nodejs.org/) -- v0.4.0 or newer


Examples
========

### Setup/Initialization code

    var NNTP = require('./nntp'), inspect = require('util').inspect, conn;

    // Be lazy and always exit the process on any error
    function die(e) {
      console.error(e);
      process.exit(1);
    }

    conn = new NNTPClient({
      host: 'news.example.com'
    });
    conn.on('connect', function() {
      conn.auth('foo', 'bar', function(e) {
        if (e) die(e);
        doActions();
      });
    });
    conn.on('error', function(err) {
      console.error('Error: ' + inspect(err));
    });
    conn.connect();

* Get a list of all non-empty newsgroups beginning with "alt.binaries.":

        function doActions() {
          conn.groups('alt.binaries.*', true, function(e, em) {
            if (e) die(e);
            em.on('group', function(name, count, status) {
              console.log(name + ': ' + count + ' articles');
            });
            em.on('end', function() {
              console.log('Done fetching groups!');
              conn.end();
            });
          });
        };

* Download the body of a specific message and save it to disk:

        function doActions() {
          conn.body('<some.message.id@baz>', function(e, em) {
            if (e) die(e);
            var file = require('fs').createWriteStream('body.dat');
            em.on('line', function(line) {
              file.write(line);
              file.write('\r\n');
            });
            em.on('end', function() {
              file.end();
              conn.end();
            });
          });
        };

* Post a message to alt.test:

        function doActions() {
          var msg = {
            from: { name: 'Node User', email: 'user@example.com' },
            groups: 'alt.test',
            subject: 'Just testing, do not mind me',
            body: 'node.js rules!'
          };
          conn.post(msg, function(e) {
            if (e) die(e);
            console.log('Message posted successfully!');
            conn.end();
          });
        };

* Get the descriptions of alt.binaries.freeware and news.test:

        function doActions() {
          var groups = ['alt.binaries.freeware', 'news.test'];
          conn.groupsDescr(groups, function(e, em) {
            if (e) die(e);
            em.on('description', function(name, description) {
              console.log(name + ': ' + description);
            });
            em.on('end', function() {
              console.log('End of descriptions');
              conn.end();
            });
          });
        };


API
===

_Events_
--------

* **connect**() - Fires when a connection to the server has been successfully established.

* **timeout**() - Fires when a connection to the server was not made within the configured amount of time.

* **close**(Boolean:hasError) - Fires when the connection is completely closed (similar to net.Socket's close event). The specified Boolean indicates whether the connection was terminated due to a transmission error or not.

* **end**() - Fires when the connection has ended.

* **error**(Error:err) - Fires when an exception/error occurs (similar to net.Socket's error event). The given Error object represents the error raised.


_Methods_
---------

**\* Note 1: If a particular action results in an NNTP-specific error, the error object supplied to the callback or 'error' event will contain 'code' and 'text' properties that contain the relevant NNTP response code and the associated error text respectively.**

**\* Note 2: Methods that return a Boolean success value will immediately return false if the action couldn't be carried out for reasons including: no server connection or the relevant command is not available on that particular server.**

**\* Note 3: A 'filter' parameter is a single (or list of) wildcard-capable newsgroup name filter string(s) ([information on the wildcard format](http://tools.ietf.org/html/rfc3977#section-4.2) and [wildcard examples](http://tools.ietf.org/html/rfc3977#section-4.4)).**

### Standard

* **(constructor)**([Object:config]) - Creates and returns a new instance of an nntp connection. config has these options and defaults:

        {
          host: 'localhost',
          port: 119,
          connTimeout: 60000 // connection timeout in milliseconds
        }

* **connect**([Number:port], [String:host]) - _(void)_ - Attempts to connect to the NNTP server. If the port and host are specified here, they override and overwrite those set in the constructor.

* **end**() - _(void)_ - Closes the connection to the server.

* **auth**([String:username], [String:password], Function:callback) - _Boolean:success_ - Authenticates with the server. The callback has these parameters: the error (undefined if none).

* **groups**([String/Array:filter], [Boolean:skipEmpty=false], Function:callback) - _Boolean:success_ - Retrieves a list of newsgroups. If skipEmpty is true, newsgroups with no articles will be filtered out. The callback has these parameters: the error (undefined if none) and an EventEmitter. The EventEmitter emits the following events:

    * **group**(String:groupName, Integer:articleCount, String:status) - Self explanatory. status is 'y' if you are allowed to post, 'n' if you're not, and 'm' if the group is moderated.

    * **end**() - Emitted at the end of the group list.

* **groupsDescr**([String/Array:filter], Function:callback) - _Boolean:success_ - Retrieves newsgroup descriptions. The callback has these parameters: the error (undefined if none) and an EventEmitter. The EventEmitter emits the following events:

    * **description**(String:groupName, String:description) - Self explanatory.

    * **end**() - Emitted at the end of the description list.

* **dateTime**(Function:callback) - _Boolean:success_ - Retrieves the server's UTC date and time (24-hour clock). The callback has these parameters: the error (undefined if none) and an Object with these Integer properties: year, month (1-based), date, hour, minute, and second.

* **articlesSince**(String/Array:filter, Date:date, Function:callback) - _Boolean:success_ - Alternative form of articlesSince that uses a Date object instead of a separate date and time string.

* **articlesSince**(String/Array:filter, String:date, String:time, Function:callback) - _Boolean:success_ - Retrieves message IDs of articles that were posted after the given UTC date (YYYYmmdd) and time (HHMMSS). The callback has these parameters: the error (undefined if none) and an EventEmitter. The EventEmitter emits the following events:

    * **messageID**(String:messageID) - Self explanatory.

    * **end**() - Emitted at the end of the message ID list.

* **articleExists**(String:messageID, Function:callback) - _Boolean:success_ - Checks if the server has the article identified by messageID. The callback has these parameters: the error (undefined if none) and a Boolean indicating if the server has the article.

* **group**(String:groupName, Function:callback) - _Boolean:success_ - Sets the current newsgroup. The callback has these parameters: the error (undefined if none).

* **articleNext**(Function:callback) - _Boolean:success_ - Selects the next article in the current newsgroup. The callback has these parameters: the error (undefined if none).

* **articlePrev**(Function:callback) - _Boolean:success_ - Selects the previous article in the current newsgroup. The callback has these parameters: the error (undefined if none).

* **post**(Object:msg, Function:callback) - _Boolean:success_ - Posts the defined msg (as defined below) to the current newsgroup. The callback has these parameters: the error (undefined if none).

    * **Object:from** - Who the message is from (you).
    
        * **String:name**
        
        * **String:email** - Example: user@example.com

    * **Array/String:groups** - The newsgroup or list of newsgroups to post the article to.

    * **String:subject** - The subject line.

    * **String:body** - The content.

* **headers**([String:messageID], Function:callback) - _Boolean:success_ - Retrieves the headers of a particular article. If messageID is not given, the currently selected article is used. The callback has these parameters: the error (undefined if none), an EventEmitter, and the message ID of the article. The EventEmitter emits the following events:

    * **header**(String:fieldName, String:value) - Self explanatory.

    * **end**() - Emitted at the end of the header list.

* **body**([String:messageID], Function:callback) - _Boolean:success_ - Retrieves the body of a particular article. If messageID is not given, the currently selected article is used. The callback has these parameters: the error (undefined if none), an EventEmitter, and the message ID of the article. The EventEmitter emits the following events:

    * **line**(Buffer:lineData) - lineData does not contain the line ending (\r\n).

    * **end**() - Emitted when the end of the message has been reached.

* **article**([String:messageID], Function:callback) - _Boolean:success_ - Retrieves the headers and body of a particular article. If messageID is not given, the currently selected article is used. The callback has these parameters: the error (undefined if none), an EventEmitter, and the message ID of the article. The EventEmitter emits the following events:

    * **header**(String:fieldName, String:value) - Self explanatory.

    * **line**(Buffer:lineData) - lineData does not contain the line ending (\r\n).

    * **end**() - Emitted when the end of the message has been reached.
