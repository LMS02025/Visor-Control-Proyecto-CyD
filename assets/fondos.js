(function(){var b=document.querySelector(".fondo");if(!b)return;var n=7,e=[],c=0,i;
for(i=1;i<=n;i++){var d=document.createElement("i");d.style.backgroundImage='url("explorador/fondos/'+i+'.jpg")';b.appendChild(d);e.push(d)}
e[0].className="on";
if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;
setInterval(function(){e[c].className="";c=(c+1)%n;e[c].className="on"},14000)})();
(function(){if(!("IntersectionObserver"in window)||(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches))return;
var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add("revela");x.target.classList.remove("oculta");io.unobserve(x.target)}})},{threshold:.06});
document.querySelectorAll(".card").forEach(function(c){if(c.getBoundingClientRect().top>innerHeight){c.classList.add("oculta");io.observe(c)}})})();
