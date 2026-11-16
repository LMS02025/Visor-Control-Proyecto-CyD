(function(){var K="modo-visor-cyd",M=["dia","noche"],L={dia:"Día",noche:"Noche"},
I={dia:'<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4 7 7M17 17l1.6 1.6M5.4 18.6 7 17M17 7l1.6-1.6"/>',noche:'<path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8z"/>'},r=document.documentElement,m;
try{m=localStorage.getItem(K)}catch(e){}
if(M.indexOf(m)<0)m=(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"dia":"noche";
r.setAttribute("data-modo",m);
function pinta(b){b.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+I[m]+'</svg>'+L[m];b.title="Modo de visualización: "+L[m]+". Pulse para cambiar a "+L[M[(M.indexOf(m)+1)%2]];b.setAttribute("aria-label",b.title)}
function ini(){var b=document.getElementById("btn-modo");if(!b)return;pinta(b);b.addEventListener("click",function(){m=M[(M.indexOf(m)+1)%2];r.classList.add("cambio");r.setAttribute("data-modo",m);try{localStorage.setItem(K,m)}catch(e){}pinta(b);setTimeout(function(){r.classList.remove("cambio")},500)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ini);else ini()})();
