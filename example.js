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
