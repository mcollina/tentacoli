# tentacoli &nbsp;&nbsp;[![Build Status](https://travis-ci.org/mcollina/tentacoli.png)](https://travis-ci.org/mcollina/tentacoli)

Multiplexing requests and streams over a single connection since 2015.

* [Install](#install)
* [Example](#example)
* [API](#api)
* [TODO](#todo)
* [Acknowledgements](#acknowledgements)
* [License](#license)

<a name="install"></a>
## Install

```
npm i tentacoli --save
```

<a name="example"></a>
## Example

```js
'use strict'

var tentacoli = require('./')
var net = require('net')
var from = require('from2')
var through = require('through2')
var pump = require('pump')

var server = net.createServer(function (original) {
  var stream = tentacoli()
  pump(stream, original, stream)

  stream.on('request', handle)
})

function handle (req, reply) {
  console.log('--> request is', req.cmd)
  reply(null, {
    data: 'some data',
    streams$: {
      echo: req.streams$.inStream.pipe(through.obj())
    }
  })
}

server.listen(4200, function () {
  var original = net.connect(4200)
  var instance = tentacoli()
  pump(original, instance, original)

  instance.request({
    cmd: 'a request',
    streams$: {
      inStream: from.obj(['hello', 'world'])
    }
  }, function (err, result) {
    if (err) {
      throw err
    }

    console.log('--> result is', result.data)
    console.log('--> stream data:')

    result.streams$.echo.pipe(through.obj(function (chunk, enc, cb) {
      cb(null, chunk + '\n')
    })).pipe(process.stdout)
    result.streams$.echo.on('end', function () {
      console.log('--> ended')
      instance.destroy()
      server.close()
    })
  })
})
```

Yes, it is long.

<a name="api"></a>
## API

  * <a href="#constructor"><code><b>tentacoli()</b></code></a>
  * <a href="#request"><code>instalce.<b>request()</b></code></a>
  * <a href="#request-event"><code>instance.<b>on('request', cb)</b></code></a>

-------------------------------------------------------
<a name="constructor"></a>
### tentacoli([opts])

Creates a new instance of Tentacoli, which is a
[Duplex](https://nodejs.org/api/stream.html#stream_class_stream_duplex)
stream and inherits from [multiplex](http://npm.im/multiplex)

It accepts the following option:

* `codec`: an object with a `encode` and `decode` method, which will
  be used to encode messages. Valid encoding libraries are
  [protocol-buffers](http://npm.im/protocol-buffers) and
  [msgpack5](http://npm.im/msgpack5). The default one is JSON.
  This capability is provided by
  [net-object-stream](http://npm.im/net-object-stream).

-------------------------------------------------------
<a name="request"></a>
### instance.request(message, callback(err, res))

Sends a request to the remote peer.

  * `message` is a standard JS object, but all streams contained in its
    `streams$` property will be multiplexed and forwarded to the other
    peer.
  * `callback` will be called if an error occurred or a response is
    available. The `res.streams$` property will contain all streams
    passed by the other peer.

-------------------------------------------------------
<a name="request-event"></a>
### instance.on('request', callback(req, reply))

The `'request'` event is emitted when there is an incoming request.

  * `req` is the standard JS object coming from [`request`](#request),
     and all the streams contained in its
    `streams$` property will have been multiplexed and forwarded from
    the other peer.
  * `reply` is the function to send a reply to the other peer, and it
    follows the standard node callback pattern: `reply(err, res).`
    The `res.streams$` property should contain all the streams
    that need to be forwarded to the other peer.

<a name="todo"></a>
## TODO

* [ ] battle test it, you can definitely help! I am particularly
  concerned about error handling, I do not want tentacoli to crash
  your process.
* [ ] figure out how to handle reconnects.
* [ ] provide examples, with WebSockets (via
  [websocket-stream](http://npm.im/websocket-stream) net, SSL, etc..
* [ ] provide an example where a request is forwarded sender -> router
  -> receiver. With streams!
* [ ] tentacoli needs a microservice framework as its companion, but it
  is framework agnostic. We should build a
  [seneca](http://npm.im/seneca) transport and probably something more
  lean too.

<a name="acknowledgements"></a>
## Acknowledgements

This library would not be possible without the great work of
[@mafintosh](http://gitub.com/mafintosh),
[@substack](http://github.com/substack) and
[@maxodgen](http://github.com/maxodgen). This library is fully based on
their work, look at package.json!

Another great source of inspriation was [jschan](http://npm.im/jschan)
from which I borrowed a lot of ideas. Thanks [Adrian
Roussow](https://github.com/AdrianRossouw) for all the discussions
around microservices, streams and channels.

Many thanks to [@mcdonnelldean](http://github.com/mcdonnelldean) for
providing an excuse to write this random idea out.

<a name="license"></a>
## License

MIT
