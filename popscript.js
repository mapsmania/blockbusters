(async function() {
  // URLs
  const DATA_URL = 'https://mapsmania.github.io/typographic/states.json';
  const POP_URL = 'population.json';

  // Fetch GeoJSON
  const resp = await fetch(DATA_URL);
  const gj = await resp.json();

  // Fetch population data
  const popResp = await fetch(POP_URL);
  const popData = await popResp.json(); // { "AL": 5024279, ... }

  // DOM elements
  const svg = document.getElementById('hexsvg');
  const tip = document.getElementById('tip');
  const questionPanel = document.getElementById('questionPanel');
  const questionText = document.getElementById('questionText');
  const scoreElement = document.getElementById('score');
  const gameOverPanel = document.getElementById('gameOver');
  const finalScoreElement = document.getElementById('finalScore');
  const restartBtn = document.getElementById('restartBtn');
  const W = 960, H = 600;

  // Game state
  let score = 0;
  let currentState = null;
  let neighborState = null;
  let currentQuestion = null;
  let incorrectStates = new Set();
  let correctStates = new Set();
  let statePaths = [];
  let vertexSets = [];

  const eastCoastStates = new Set(['ME','NH','RI','CT','DE','DC','SC','GA','FL']);

  // Utilities
  function eachPolygonCoords(feature, cb) {
    const g = feature.geometry;
    if (!g) return;
    if (g.type === 'Polygon') g.coordinates.forEach(ring => cb(ring));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(polygon => polygon.forEach(ring => cb(ring)));
  }

  function computeBounds(features) {
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const f of features) eachPolygonCoords(f, ring => ring.forEach(([x,y]) => {
      minX=Math.min(minX,x); minY=Math.min(minY,y);
      maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
    }));
    return {minX, minY, maxX, maxY};
  }

  function createProjector(bounds, pad=24) {
    const {minX,minY,maxX,maxY}=bounds;
    const dx=maxX-minX, dy=maxY-minY;
    const sx=(W-2*pad)/(dx||1), sy=(H-2*pad)/(dy||1);
    const s=Math.min(sx,sy);
    const tx=(W-s*dx)/2-s*minX, ty=(H-s*dy)/2+s*maxY;
    return ([x,y])=>[s*x+tx,-s*y+ty];
  }

  function polygonCentroid(ring) {
    let area=0,cx=0,cy=0;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [x0,y0]=ring[j], [x1,y1]=ring[i];
      const a=x0*y1-x1*y0;
      area+=a; cx+=(x0+x1)*a; cy+=(y0+y1)*a;
    }
    area*=0.5;
    if(area===0) return ring[0];
    return [cx/(6*area), cy/(6*area)];
  }

  function featureLabel(props={}) { return props.name||props.state||props.postal||props.abbr||''; }
  function getStateAbbr(props={}) { return (props.postal||props.abbr||props.state||props.name||'').toString().toUpperCase(); }

  function blinkState(element, color1='var(--selected)', color2='#facc15', interval=500, times=6) {
    let count=0;
    const blinkInterval=setInterval(()=>{
      element.style.fill=(count%2===0)?color2:color1;
      count++;
      if(count>=times){ clearInterval(blinkInterval); element.style.fill=color1; }
    }, interval);
  }

  // --- Initialize game ---
  function initializeGame() {
    score=0; scoreElement.textContent=score;
    currentState=null; neighborState=null; currentQuestion=null;
    incorrectStates=new Set(); correctStates=new Set();
    statePaths=[]; vertexSets=[];

    svg.innerHTML='';
    const g = document.createElementNS('http://www.w3.org/2000/svg','g'); svg.appendChild(g);
    const features = gj.type==='FeatureCollection'?gj.features:[gj];
    const bounds = computeBounds(features);
    const project=createProjector(bounds);

    vertexSets = features.map(f => {
      const s=new Set();
      eachPolygonCoords(f, ring => ring.forEach(([x,y]) => s.add(`${x.toFixed(6)},${y.toFixed(6)}`)));
      return s;
    });

    const westCoastStates = new Set(['WA','OR','CA','ID']);
    const startCandidates=[];
    for(let i=0;i<features.length;i++){
      const ab=getStateAbbr(features[i].properties);
      if(westCoastStates.has(ab)) startCandidates.push(i);
    }
    const startIndex = startCandidates.length>0 ? startCandidates[Math.floor(Math.random()*startCandidates.length)] : Math.floor(Math.random()*features.length);

    for(let fi=0;fi<features.length;fi++){
      const f=features[fi]; if(!f.geometry) continue;
      const labelText=featureLabel(f.properties);
      const polys = (f.geometry.type==='Polygon')?[f.geometry.coordinates]:(f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[]);
      for(const polygon of polys){
        const exterior=polygon[0]; let d='';
        for(const ring of polygon) ring.forEach((pt,i)=>{ const [x,y]=project(pt); d+=(i===0?`M ${x} ${y}`:` L ${x} ${y}`); });
        d+=' Z ';
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d', d.trim()); path.setAttribute('class','hex'); path.setAttribute('tabindex','0');
        path.setAttribute('role','img'); path.setAttribute('aria-label',labelText||'state'); path.setAttribute('data-index',fi);
        if(fi===startIndex){ path.style.fill='var(--start)'; path.style.cursor='pointer'; currentState={index:startIndex,name:labelText,element:path}; correctStates.add(startIndex);}
        else path.style.fill='var(--fill)'; path.style.cursor='default';
        path.addEventListener('pointerenter', e=>{ tip.textContent=labelText; tip.style.transform=`translate(${e.clientX+12}px,${e.clientY+12}px)`; });
        path.addEventListener('pointermove', e=>{ tip.style.transform=`translate(${e.clientX+12}px,${e.clientY+12}px)`; });
        path.addEventListener('pointerleave', ()=>{ tip.style.transform='translate(-9999px,-9999px)'; });
        g.appendChild(path); statePaths.push(path);

        const [cx0,cy0]=polygonCentroid(exterior); const [cx,cy]=project([cx0,cy0]);
        const text=document.createElementNS('http://www.w3.org/2000/svg','text'); text.setAttribute('x',cx); text.setAttribute('y',cy); text.setAttribute('class','label'); text.textContent=labelText;
        g.appendChild(text);
      }
    }

    updateNeighborStates(startIndex);
    questionPanel.style.display='none'; gameOverPanel.style.display='none';
  }

  // --- Update neighbor states ---
  function updateNeighborStates(centerIndex){
    for(let i=0;i<statePaths.length;i++){
      if(!correctStates.has(i)&&!incorrectStates.has(i)){
        statePaths[i].style.fill='var(--fill)'; statePaths[i].style.cursor='default';
        const newPath=statePaths[i].cloneNode(true); statePaths[i].parentNode.replaceChild(newPath,statePaths[i]); statePaths[i]=newPath;
      }
    }

    const centerSet=vertexSets[centerIndex]||new Set();
    for(let i=0;i<statePaths.length;i++){
      if(i===centerIndex||correctStates.has(i)||incorrectStates.has(i)) continue;
      const s=vertexSets[i]; let touches=false;
      for(const v of s){ if(centerSet.has(v)){ touches=true; break; }}
      if(touches){
        statePaths[i].style.fill='var(--neighbor)'; statePaths[i].style.cursor='pointer';
        statePaths[i].addEventListener('click', ()=>{
          if(correctStates.has(i)||incorrectStates.has(i)) return;
          neighborState={index:i,name:featureLabel(gj.features[i].properties),element:statePaths[i]};
          showQuestion();
        });
      }
    }
  }

  // --- Show question using population ---
  function showQuestion(){
    if(!currentState||!neighborState) return;

    currentQuestion = {
      neighborName: neighborState.name,
      currentName: currentState.name,
      neighborPop: popData[getStateAbbr(gj.features[neighborState.index].properties)],
      currentPop: popData[getStateAbbr(gj.features[currentState.index].properties)],
      neighborIndex: neighborState.index,
      currentIndex: currentState.index
    };

    questionText.textContent = `Does ${neighborState.name} have a lower or higher population than ${currentState.name}?`;
    questionPanel.style.display='block';
    questionPanel.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  // --- Check for game over ---
  function checkLoseCondition(){
    const currentIndex=currentState.index;
    const centerSet=vertexSets[currentIndex]||new Set();
    let hasNeighbors=false;
    for(let i=0;i<statePaths.length;i++){
      if(correctStates.has(i)||incorrectStates.has(i)) continue;
      const s=vertexSets[i]; for(const v of s){ if(centerSet.has(v)){ hasNeighbors=true; break; } }
      if(hasNeighbors) break;
    }
    if(!hasNeighbors) endGame("😞 No more moves available! You lost.");
  }

  // --- Check answer ---
  function checkAnswer(isLower){
    if(!currentQuestion) return;
    const correctAnswer = currentQuestion.neighborPop < currentQuestion.currentPop;

    if(isLower===correctAnswer){
      score+=10; scoreElement.textContent=score;
      neighborState.element.style.fill='var(--selected)'; correctStates.add(neighborState.index);
      currentState=neighborState;

      const abbr=getStateAbbr(gj.features[currentState.index].properties);
      if(eastCoastStates.has(abbr)){ blinkState(currentState.element,'var(--selected)','#facc15',500,6); endGame(`🎉 Congratulations! You reached the East Coast: ${abbr}!`); return; }

      updateNeighborStates(currentState.index);
    } else {
      neighborState.element.style.fill='var(--incorrect)'; incorrectStates.add(neighborState.index); neighborState.element.style.cursor='default';
    }

    neighborState=null; questionPanel.style.display='none';
    checkLoseCondition();
  }

  // --- End game ---
  function endGame(message="You've created a path across the US!"){
    finalScoreElement.textContent=score;
    gameOverPanel.querySelector('h2').textContent="Game Over!";
    gameOverPanel.querySelector('p').textContent=message;
    gameOverPanel.style.display='block';
  }

  // Initialize
  initializeGame();

  // Button events
  document.getElementById('btnLower').addEventListener('click',()=>{checkAnswer(true);});
  document.getElementById('btnHigher').addEventListener('click',()=>{checkAnswer(false);});
  restartBtn.addEventListener('click',initializeGame);

})();
