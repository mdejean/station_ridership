"use strict";

function range(first, last, step) {
    let ret = [];
    for (let t = first; t < last; t += step) {
        ret.push(t);
    }
    return ret;
}

function first_order(tau, gain) {
    if (!gain) gain = 1;
    let f = function(t) {
            return t < 0 ? 0 : gain * Math.exp(-t/tau);
        };
    f.integral = function (a, b) {
            if (a < 0) a = 0;
            if (b < 0) b = 0;
            return -tau * gain * (Math.exp(-b/tau) - Math.exp(-a/tau));
        };
    return f;
}

function factorial(x) {
    let y = 1;
    while (x > 0) {
        y *= x--;
    }
    return y;
}

function Si(x) {
    if (x < 0) return -Si(-x);
    if (x == 0) return 0;
    if (x > 3.85) return Math.PI/2 + Math.cos(x) * (-1/x + 2/(x*x*x)) + Math.sin(x) * (-1/(x*x));
    if (x > 3.75) return lerp(Si(3.74), Si(3.86), 3.74, 3.86, x); 
    let y = 0;
    for (let n = 1; n < 12; n+=2) {
        let y_old = y;
        y += (n & 2 ? -1 : 1) * Math.pow(x, n) / (n * factorial(n));
    }
    return y;
}

function sinc(x) {
    return x == 0 ? 1 : Math.sin(x) / x;
}

function unity() {
    let f = function(x) {return 0;};
    f.integral = function(a, b) {
        if (a <= 0 && b > 0) return 1;
        if (a > 0 && b <= 0) return -1;
        return 0;
    }
    return f;
}

function timeshift(ir, delta) {
    let f = function(x) {return ir(x-delta);}
    f.integral = function(a, b){return ir.integral(a - delta, b - delta);}
    return f;
}

function brickwall(period) {
    let f = function(x) {
        return 1/(period * Math.PI) * sinc(2 * x / period);
    }
    f.antiderivative = function(x) {
        return Si(x / period) / Math.PI;
    }
    f.integral = function(a, b) {
        return f.antiderivative(b) - f.antiderivative(a);
    }
    return f;
}

function forward_backward(ir) {
    let f = function(x) {
        return x > 0 ? ir(x) : ir(-x);
    };
    f.integral = function(a, b) {
        let sum = 0;
        if (a < 0) {
            sum += ir.integral(0, -a);
        } else {
            sum -= ir.integral(0, a);
        }
        if (b < 0) {
            sum -= ir.integral(0, -b);
        } else {
            sum += ir.integral(0, b);
        }
        return sum;
    }
    return f;
}
        

function interpolate_filter(xs, ys, ir) {
    return function(x) {
        let a = 0;
        a += ir.integral(x - xs[1], 1e9) * ys[0];
        for (let i = 1; i < xs.length - 1; i++) {
            a += ir.integral(x - xs[i+1], x - xs[i]) * ys[i];
        }
        a += ir.integral(-1e9, x - xs[xs.length - 1]) * ys[ys.length - 1];
        return a;
    }
}


function derivative(f, scale, min_step) {
    const eps = 1e-3;
    if (!min_step) min_step = eps;
    return function(x) {
        let h = 1/eps;
        let d = Number.POSITIVE_INFINITY;
        do {
            let d_old = d;
            
            d = ( f(x+h) - f(x-h) ) / ( 2 * h );
            
            if (Math.abs(d - d_old) < eps) {
                break;
            }
            
            h /= 2;
        } while (h > min_step);
        return scale*d;
    }
}

function lerp(x0, x1, t0, t1, t) {
    if (t < t0) return x0;
    if (t > t1) return x1;
    return x0 + (t - t0) * (x1 - x0) / (t1 - t0);
}

function duration(s) {
    let a = s.split(" ");
    let multiplier = 1;
    switch (a[1]) {
        case "century": case "centuries":
            multiplier *= 10;
        case "decade": case "decades":
            multiplier *= 10;
        case "year": case "years":
            multiplier *= 12;
        case "month": case "months":
            multiplier *= 52/12;
        case "week": case "weeks":
            multiplier *= 7;
        case "day": case "days":
            multiplier *= 24;
        case "hour": case "hours":
            multiplier *= 60;
        case "minute": case "minutes":
            multiplier *= 60;
        case "second": case "seconds":
        default:
    }
    return multiplier * Number.parseFloat(a[0]);
}

function draw(div, data, options) {
    let points = data;
    let period = duration(options.period);
    
    let start = points.findIndex(p => p.ending > options.start.getTime()/1000 - 2*period) - 1;
    if (start < 0) start = 0;
    
    let end = points.findIndex(p => p.ending > options.end.getTime()/1000 + 2*period);
    if (end == -1) end = points.length;
    
    points = points.slice(start, end);
    
    let filter = null;
    
    if (options.filter == 'none') {
        filter = function(ts, xs) {
                return function(t) {
                    if (t <= ts[0]) return xs[0];
                    
                    for (let i = 0; i < ts.length; i++) {
                        if (t >= ts[i] && t < ts[i+1]) return xs[i];
                    }
                    
                    return xs[xs.length - 1];
                }
            };
    } else if (options.filter == 'linear') {
        filter = function(ts, xs) {
                return function(t) {
                    if (t <= ts[0]) return xs[0];
                    
                    for (let i = 0; i < ts.length - 1; i++) {
                        if (t >= ts[i] && t < ts[i+1]) {
                            return lerp(xs[i], xs[i+1], ts[i], ts[i+1], t);
                        }
                    }
                    return xs[xs.length - 1];
                }
            };
    } else if (options.filter == 'monotone') {
        filter = monotonicInterpolant;
    } else if (options.filter == 'firstorder') {
        filter = function(ts,xs) {
                return interpolate_filter(ts, xs, 
                    forward_backward(first_order(period)) );
            };
    } else if (options.filter == 'sinc') {
        filter = function(ts,xs) {
                return interpolate_filter(ts, xs, 
                    brickwall(period) );
            };
    }
    
    let entries = filter(points.map(p => p.ending), points.map(p => p.entries));
    let exits = filter(points.map(p => p.ending), points.map(p => p.exits));
    
    if (!options.cumulative) {
        entries = derivative(entries, 60 * 60, 60);
        exits = derivative(exits, 60 * 60, 60);
    }
    
    let plot_t = range(options.start.getTime()/1000, options.end.getTime()/1000, (options.end.getTime() - options.start.getTime())/(1000 * 250));
    
    let plots = [];
    if (options.entries) {
        plots.push({
                data: plot_t.map((a) => [a * 1000, entries(a)]),
                label: "entries"
            });
    }
    if (options.exits) {
        plots.push({
                data: plot_t.map((a) => [a * 1000, exits(a)]),
                label: "exits"
            });
    }
    
    $.plot(div, plots,
        {
            xaxes: [ {mode: 'time'} ],
            yaxes: [ {label: options.cumulative ? "Riders" : "Riders per hour"} ],
            legend: { position: 'nw' }
        });
};

var options = {
    options: {
        start: {type: 'date', label: "Start", default: "2017-12-11"},
        end: {type: 'date', label: "End", default: "2017-12-18"},
        group: {
            type: 'list', 
            items: {
                    '': {label: "No grouping"},
                    day: {label: "Day"},
                    week: {label: "Week"},
                    month: {label: "Month"},
                    year: {label: "Year"},
                },
            default: ''
        },
        cumulative: {type: 'checkbox', label: "Cumulative", default: true},
        filter: {
            type: 'list',
            items: {
                    none: {label: "No interpolation"},
                    linear: {label: "Linear"},
                    monotone: {label: "Monotonic cubic"},
                    firstorder: {label: "First order"},
                    sinc: {label: "Sinc"},
                },
            default: 'sinc'
        },
        period: {type: 'text', label: "Filter period", default: "1 hour"},
        entries: {type: 'checkbox', label: "Entries", default: true},
        exits: {type: 'checkbox', label: "Exits", default: true}
    },
    get: function() {
        let ret = {};
        for (let key in this.options) {
            let e = document.getElementById(key);
            switch (this.options[key].type) {
                case 'date':
                    ret[key] = new Date(e.value);
                    break;
                case 'checkbox':
                    ret[key] = e.checked;
                    break;
                default:
                    ret[key] = e.value;
                    break;
            }
        }
        return ret;
    },
    form: function() {
        let parent = document.createElement('div');
        for (let key in this.options) {
            let label = document.createElement('label');
            label.textContent = this.options[key].label || "";
            
            switch (this.options[key].type) {
                case 'checkbox':
                default: {
                    let e = document.createElement('input');
                    e.type = this.options[key].type;
                    if (this.options[key].type == 'checkbox') {
                        e.checked = this.options[key].default;
                    } else {
                        e.value = this.options[key].default;
                    }
                    e.id = key;
                    label.appendChild(e);
                    break;
                }
                case 'list': {
                    let e = document.createElement('select');
                    e.id = key;
                    
                    for (let item in this.options[key].items) {
                        let i = document.createElement('option');
                        i.value = item;
                        i.textContent = this.options[key].items[item].label;
                        if (item == this.options[key].default) {
                            i.selected = true;
                        }
                        e.appendChild(i);
                    }
                    label.appendChild(e);
                    break;
                }
            }
            
            parent.appendChild(label);
            parent.appendChild(document.createElement('br'));
        }
        
        return parent;
    },
    addEventListener: function(evt, listener) {
        for (let key in this.options) {
            document.getElementById(key).addEventListener(evt, listener);
        }
    },
    removeEventListener: function(evt, listener) {
        for (let key in this.options) {
            document.getElementById(key).removeEventListener(evt, listener);
        }
    }
}

var latest = new Date('2018-09-28')

async function get_data(stop, group, start, end) {
    if (group == 'day' || !group) {
        let fetches = [];
        
        function f(year, month) {
            fetches.push($.ajax({
                url: 'data/' + stop.station_id + '/' + year + '/' + (month + 1) + '.json',
                dataType: 'json'
                }));
        }
        
        if (start.getFullYear() != end.getFullYear()) {
            for (let year = start.getFullYear(); year < end.getFullYear(); year++) {
                for (let month = (year == start.getFullYear() ? start.getMonth() : 0); month < 12; month++) {
                    f(year, month);
                }
            }
        }
        
        for (let month = start.getFullYear() == end.getFullYear() ? start.getMonth() : 0; month <= end.getMonth(); month++) {
            f(end.getFullYear(), month);
        }
        
        let entries = 0;
        let exits = 0;
        let prev_end = 0;
        
        let ret = [];
        for (let f of fetches) {
            let a = await f;
            if (group == 'day') {
                for (let p of a) {
                    entries += p.entries;
                    exits += p.exits;
                    if (p.ending % (60 * 60 * 24) < prev_end % (60 * 60 * 24)) {
                        ret.push({"ending": p.ending, "entries": entries, "exits": exits});
                    }
                    prev_end = p.ending;
                }
            } else {
                for (let p of a) {
                    entries += p.entries;
                    exits += p.exits;
                    ret.push({"ending": p.ending, "entries": entries, "exits": exits});
                }
            }
                
        }
        
        return ret;
    }
}
    

function popup(stop) {
    let ret = L.popup({maxWidth: 1000});
    
    let p = document.createElement('div');

    let label = document.createElement('div');
    label.setAttribute('class', 'chart_title');
    label.textContent = stop.stop_name;
    p.appendChild(label);

    let g = document.createElement('div');
    g.setAttribute('class', 'chart');
    p.appendChild(g);
    
    ret.setContent(p);
    
    ret.on('add', function() {
            async function redraw() {
                let o = options.get();
                draw(g, await get_data(stop, o.group, o.start, o.end), o);
            }
            options.addEventListener('change', redraw);
            ret.on('remove', () => {
                    options.removeEventListener('change', redraw);
                });
            redraw();
        });
    return ret;
}

$(document).ready(function() {
    var stop_icon = L.divIcon({className: 'stop', iconSize: false, anchor:false});
    var map = L.map("map", {
            closePopupOnClick: false
        }).setView([40.7199, -73.9490], 11);
    
    let opts = L.control({position: 'topright'});
    opts.onAdd = function(map) {
            this.content = L.DomUtil.create('div', 'opts');
            this.content.appendChild(options.form());
            return this.content;
        };
    
    opts.addTo(map);
    
    
    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>',
        maxZoom: 15
    }).addTo(map);
    $.ajax({
            url: 'data/stops.json', 
            ifModified: false,
            dataType: 'json'
        }).then(function(r) {
            let stops = r;
            if (stops == null) {
                L.text("error loading stops").addTo(map);
            }
            for (let stop of stops) {
                let marker = L.marker([stop.stop_lat, stop.stop_lon], 
                    {icon: stop_icon});
                marker.bindPopup(popup(stop), {maxWidth: 1000});
                marker.addTo(map);
            }
        }, r => console.log(r.state()));
    $.ajax({url: 'data/shapes.json',  
            ifModified: false,
            dataType: 'json'
        }).then(function(r) {
            let shapes = r;
            for (let shape_id in shapes) {
                L.polyline(shapes[shape_id].shape, 
                    {
                        color: '#' + shapes[shape_id].color,
                        interactive: false,
                        opacity: 0.9,
                        weight: 2
                    }).addTo(map);
            }
        });
    $.ajax({url: 'data/transfers.json',  
            ifModified: false,
            dataType: 'json'
        }).then(function(transfers) {
            for (let t of transfers) {
                L.polyline(t, 
                    {
                        color: 'black',
                        interactive: false,
                        weight: 2
                    }).addTo(map);
            }
        });
});