// Page views (Cloudflare Web Analytics) and the opt-out that also silences the anonymous counts.
//
// The beacon used to be injected by Cloudflare into every page of the zone, which counted our own
// testing with everyone else's and could not be turned off per browser. Loaded here instead: only on
// the production host, and not in a browser that has opted out. Open any page with ?notrack=1 once
// to set the flag (localStorage "igt.notrack"), ?notrack=0 to clear it. app.js count() reads the
// same flag. Classic script, loaded from every page's <head>, so it runs before app.js.
(function () {
  try {
    var q = location.search;
    if (/[?&]notrack=1\b/.test(q)) localStorage.setItem("igt.notrack", "1");
    if (/[?&]notrack=0\b/.test(q)) localStorage.removeItem("igt.notrack");
    if (localStorage.getItem("igt.notrack")) return;
  } catch (e) {}
  if (location.hostname !== "igt.iqis.app") return;
  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", '{"token": "b3d57b3540634182829ee631ed174345"}');
  document.head.appendChild(s);
})();
