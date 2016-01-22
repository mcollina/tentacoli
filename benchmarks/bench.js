'use strict'

var minimist = require('minimist')
var bench = require('fastbench')
var pump = require('pump')
var net = require('net')
var childProcess = require('child_process')
var path = require('path')
var parallel = require('fastparallel')()
var tentacoli = require('../')

var argv = minimist(process.argv.slice(2), {
  boolean: 'child',
  default: {
    child: true,
    port: 3000,
    host: 'localhost'
  }
})

function buildPingPong (cb) {
  var sender = tentacoli()
  var timer = setTimeout(function () {
    throw new Error('unable to start child')
  }, 1000)
  var child

  if (argv.child) {
    child = childProcess.fork(path.join(__dirname, 'tentacoli_echo.js'), {
      stdio: 'inherit'
    })

    child.on('message', start)

    child.on('error', cb)

    child.on('exit', console.log)
  } else {
    start(argv)
  }

  function start (addr) {
    var client = net.connect(addr.port, addr.host)

    client.on('connect', function () {
      cb(null, benchPingPong)
      clearTimeout(timer)
    })

    pump(client, sender, client)
  }

  var functions = [
    sendEcho, sendEcho, sendEcho, sendEcho, sendEcho,
    sendEcho, sendEcho, sendEcho, sendEcho, sendEcho
  ]

  function benchPingPong (cb) {
    parallel(null, functions, null, cb)
  }

  function sendEcho (cb) {
    sender.request({
      cmd: 'ping'
    }, cb)
  }
}

buildPingPong(function (err, benchPingPong) {
  if (err) throw err

  var run = bench([benchPingPong], 1000)

  run(function (err) {
    if (err) throw err

    run(function (err) {
      if (err) throw err

      // close the sockets the bad way
      process.exit(0)
    })
  })
})
