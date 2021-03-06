/**
* See [Demo.js](https://github.com/liabru/matter-js/blob/master/demo/js/Demo.js) 
* and [DemoMobile.js](https://github.com/liabru/matter-js/blob/master/demo/js/DemoMobile.js) for usage examples.
*
* @class Engine
*/

// TODO: multiple event handlers, before & after handlers
// TODO: viewports
// TODO: frameskipping

var Engine = {};

(function() {

    var _fps = 60,
        _deltaSampleSize = 8,
        _delta = 1000 / _fps;
        
    var _requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame
                                      || window.mozRequestAnimationFrame || window.msRequestAnimationFrame 
                                      || function(callback){ window.setTimeout(function() { callback(Common.now()); }, _delta); };
   
    /**
     * Description
     * @method create
     * @param {HTMLElement} element
     * @param {object} options
     * @return {engine} engine
     */
    Engine.create = function(element, options) {
        var defaults = {
            enabled: true,
            positionIterations: 6,
            velocityIterations: 4,
            constraintIterations: 1,
            pairs: {
                table: {},
                list: [],
                collisionStart: [],
                collisionActive: [],
                collisionEnd: []
            },
            enableSleeping: false,
            timeScale: 1,
            input: {},
            events: [],
            timing: {
                fps: _fps,
                timestamp: 0,
                delta: _delta,
                correction: 1,
                deltaMin: 1000 / _fps,
                deltaMax: 1000 / (_fps * 0.5)
            }
        };
        
        var engine = Common.extend(defaults, options);
        engine = Common.isElement(element) ? (engine || {}) : element;

        // create default renderer only if no custom renderer set
        // but still allow engine.render.engine to pass through if set
        if (!engine.render || (engine.render && !engine.render.controller)) {
            engine.render = Render.create(engine.render);
            if (Common.isElement(element))
                element.appendChild(engine.render.canvas);
        }

        engine.world = World.create(engine.world);
        engine.metrics = engine.metrics || Metrics.create();
        engine.input.mouse = engine.input.mouse || Mouse.create(engine.render.canvas);
        engine.mouseConstraint = engine.mouseConstraint || MouseConstraint.create(engine.input.mouse);
        World.addComposite(engine.world, engine.mouseConstraint);

        engine.broadphase = engine.broadphase || {
            current: 'grid',
            grid: {
                controller: Grid,
                instance: Grid.create(),
                detector: Detector.collisions
            },
            bruteForce: {
                detector: Detector.bruteForce
            }
        };

        return engine;
    };

    /**
     * Description
     * @method run
     * @param {engine} engine
     */
    Engine.run = function(engine) {
        var timing = engine.timing,
            delta,
            correction,
            counterTimestamp = 0,
            frameCounter = 0,
            deltaHistory = [];

        (function render(timestamp){
            _requestAnimationFrame(render);

            if (!engine.enabled)
                return;

            // timestamp is undefined on the first update
            timestamp = timestamp || 0;

            // create an event object
            var event = {
                timestamp: timestamp
            };

            /**
            * Fired at the start of a tick, before any updates to the engine or timing
            *
            * @event beforeTick
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            Events.trigger(engine, 'beforeTick', event);

            delta = (timestamp - timing.timestamp) || _delta;

            // optimistically filter delta over a few frames, to improve stability
            deltaHistory.push(delta);
            deltaHistory = deltaHistory.slice(-_deltaSampleSize);
            delta = Math.min.apply(null, deltaHistory);
            
            // limit delta
            delta = delta < engine.timing.deltaMin ? engine.timing.deltaMin : delta;
            delta = delta > engine.timing.deltaMax ? engine.timing.deltaMax : delta;

            // verlet time correction
            correction = delta / timing.delta;

            // update engine timing object
            timing.timestamp = timestamp;
            timing.correction = correction;
            timing.delta = delta;
            
            // fps counter
            frameCounter += 1;
            if (timestamp - counterTimestamp >= 1000) {
                timing.fps = frameCounter * ((timestamp - counterTimestamp) / 1000);
                counterTimestamp = timestamp;
                frameCounter = 0;
            }

            /**
            * Fired after engine timing updated, but just before engine state updated
            *
            * @event tick
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            /**
            * Fired just before an update
            *
            * @event beforeUpdate
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            Events.trigger(engine, 'tick beforeUpdate', event);

            // update
            Engine.update(engine, delta, correction);

            // trigger events that may have occured during the step
            _triggerCollisionEvents(engine);
            _triggerMouseEvents(engine);

            /**
            * Fired after engine update and all collision events
            *
            * @event afterUpdate
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            /**
            * Fired just before rendering
            *
            * @event beforeRender
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            Events.trigger(engine, 'afterUpdate beforeRender', event);

            // render
            if (engine.render.options.enabled)
                engine.render.controller.world(engine);

            /**
            * Fired after rendering
            *
            * @event afterRender
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            /**
            * Fired after engine update and after rendering
            *
            * @event afterTick
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            Events.trigger(engine, 'afterTick afterRender', event);
        })();
    };

    /**
     * Description
     * @method update
     * @param {engine} engine
     * @param {number} delta
     * @param {number} correction
     * @return engine
     */
    Engine.update = function(engine, delta, correction) {
        var world = engine.world,
            broadphase = engine.broadphase[engine.broadphase.current],
            broadphasePairs = [],
            i;

        Metrics.reset(engine.metrics);

        if (engine.enableSleeping)
            Sleeping.update(world.bodies);

        Body.applyGravityAll(world.bodies, world.gravity);

        MouseConstraint.update(engine.mouseConstraint, world.bodies, engine.input);

        Body.updateAll(world.bodies, delta * engine.timeScale, correction, world.bounds);

        // update all constraints
        for (i = 0; i < engine.constraintIterations; i++) {
            Constraint.updateAll(world.constraints);
        }

        // broadphase pass: find potential collision pairs
        if (broadphase.controller) {
            broadphase.controller.update(broadphase.instance, world.bodies, engine);
            broadphasePairs = broadphase.instance.pairsList;
        } else {
            broadphasePairs = world.bodies;
        }

        // narrowphase pass: find actual collisions, then create or update collision pairs
        var collisions = broadphase.detector(broadphasePairs, engine);

        // update pairs
        var pairs = engine.pairs,
            timestamp = engine.timing.timestamp;
        Manager.updatePairs(pairs, collisions, timestamp);
        Manager.removeOldPairs(pairs, timestamp);

        // wake up bodies involved in collisions
        if (engine.enableSleeping)
            Sleeping.afterCollisions(pairs.list);

        // iteratively resolve velocity between collisions
        Resolver.preSolveVelocity(pairs.list);
        for (i = 0; i < engine.velocityIterations; i++) {
            Resolver.solveVelocity(pairs.list);
        }
        
        // iteratively resolve position between collisions
        for (i = 0; i < engine.positionIterations; i++) {
            Resolver.solvePosition(pairs.list);
        }
        Resolver.postSolvePosition(world.bodies);

        Metrics.update(engine.metrics, engine);

        // clear force buffers
        Body.resetForcesAll(world.bodies);

        return engine;
    };
    
    /**
     * Description
     * @method merge
     * @param {engine} engineA
     * @param {engine} engineB
     */
    Engine.merge = function(engineA, engineB) {
        Common.extend(engineA, engineB);
        
        if (engineB.world) {
            engineA.world = engineB.world;

            Engine.clear(engineA);

            var bodies = engineA.world.bodies;

            for (var i = 0; i < bodies.length; i++) {
                var body = bodies[i];
                Sleeping.set(body, false);
                body.id = Body.nextId();
            }

            var broadphase = engineA.broadphase[engineA.broadphase.current];

            if (broadphase.controller === Grid) {
                var grid = broadphase.instance;
                Grid.clear(grid);
                Grid.update(grid, engineA.world.bodies, engineA, true);
            }
        }
    };

    /**
     * Description
     * @method clear
     * @param {engine} engine
     */
    Engine.clear = function(engine) {
        var world = engine.world;
        
        engine.pairs.table = {};
        engine.pairs.list = [];

        World.addComposite(engine.world, engine.mouseConstraint);

        var broadphase = engine.broadphase[engine.broadphase.current];

        if (broadphase.controller === Grid)
            Grid.clear(broadphase.instance);

        if (broadphase.controller) {
            broadphase.controller.update(broadphase.instance, world.bodies, engine, true);
        }
    };

    /**
     * Triggers mouse events
     * @method _triggerMouseEvents
     * @private
     * @param {engine} engine
     */
    var _triggerMouseEvents = function(engine) {
        var mouse = engine.input.mouse,
            mouseEvents = mouse.sourceEvents;

        /**
        * Fired when the mouse has moved (or a touch moves) during the last step
        *
        * @event mousemove
        * @param {} event An event object
        * @param {mouse} event.mouse The engine's mouse instance
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (mouseEvents.mousemove) {
            Events.trigger(engine, 'mousemove', {
                mouse: mouse
            });
        }

        /**
        * Fired when the mouse is down (or a touch has started) during the last step
        *
        * @event mousedown
        * @param {} event An event object
        * @param {mouse} event.mouse The engine's mouse instance
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (mouseEvents.mousedown) {
            Events.trigger(engine, 'mousedown', {
                mouse: mouse
            });
        }

        /**
        * Fired when the mouse is up (or a touch has ended) during the last step
        *
        * @event mouseup
        * @param {} event An event object
        * @param {mouse} event.mouse The engine's mouse instance
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (mouseEvents.mouseup) {
            Events.trigger(engine, 'mouseup', {
                mouse: mouse
            });
        }

        // reset the mouse state ready for the next step
        Mouse.clearSourceEvents(mouse);
    };

    /**
     * Triggers collision events
     * @method _triggerMouseEvents
     * @private
     * @param {engine} engine
     */
    var _triggerCollisionEvents = function(engine) {
        var pairs = engine.pairs;

        /**
        * Fired after engine update, provides a list of all pairs that have started to collide in the current tick (if any)
        *
        * @event collisionStart
        * @param {} event An event object
        * @param {} event.pairs List of affected pairs
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (pairs.collisionStart.length > 0) {
            Events.trigger(engine, 'collisionStart', {
                pairs: pairs.collisionStart
            });
        }

        /**
        * Fired after engine update, provides a list of all pairs that are colliding in the current tick (if any)
        *
        * @event collisionActive
        * @param {} event An event object
        * @param {} event.pairs List of affected pairs
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (pairs.collisionActive.length > 0) {
            Events.trigger(engine, 'collisionActive', {
                pairs: pairs.collisionActive
            });
        }

        /**
        * Fired after engine update, provides a list of all pairs that have ended collision in the current tick (if any)
        *
        * @event collisionEnd
        * @param {} event An event object
        * @param {} event.pairs List of affected pairs
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (pairs.collisionEnd.length > 0) {
            Events.trigger(engine, 'collisionEnd', {
                pairs: pairs.collisionEnd
            });
        }
    };

})();