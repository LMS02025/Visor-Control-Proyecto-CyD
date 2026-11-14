(function(){var K="modo-visor-cyd",M=["dia","noche"],L={dia:"Día",noche:"Noche"},
I={dia:'<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
noche:'<path d="M12 3.5l1.9 4.9 5.1.4-3.9 3.3 1.2 5-4.3-2.7-4.3 2.7 1.2-5L5 8.8l5.1-.4z"/><path d="M19.5 16.5v3M18 18h3"/>'},r=document.documentElement,m;
try{m=localStorage.getItem(K)}catch(e){}
if(M.indexOf(m)<0)m=(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"dia":"noche";
r.setAttribute("data-modo",m);
function pinta(b){b.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+I[m]+'</svg>'+L[m];b.title="Modo de visualización: "+L[m]+". Pulse para cambiar a "+L[M[(M.indexOf(m)+1)%2]];b.setAttribute("aria-label",b.title)}
function ini(){var b=document.getElementById("btn-modo");if(!b)return;pinta(b);b.addEventListener("click",function(){m=M[(M.indexOf(m)+1)%2];r.classList.add("cambio");r.setAttribute("data-modo",m);try{localStorage.setItem(K,m)}catch(e){}pinta(b);setTimeout(function(){r.classList.remove("cambio")},500)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ini);else ini()})();
