/**
 * Emergency Response System - SVG City Graph Renderer
 * Renders the Pune city road network, dynamic Dijkstra routes,
 * active emergency hazard pins, and moving response team vehicles.
 */

class CityGraphRenderer {
  constructor(svgElement, tooltipElement, onRoadClick = null, onNodeClick = null) {
    this.svg = svgElement;
    this.tooltip = tooltipElement;
    this.onRoadClick = onRoadClick;
    this.onNodeClick = onNodeClick;

    this.nodes = [];
    this.roads = [];
    this.teams = [];
    this.emergencies = [];
    this.assignments = [];

    this.width = 800;
    this.height = 600;
    this.padding = { top: 60, right: 90, bottom: 60, left: 90 };

    this.nodeCoords = new Map(); // id -> {x, y}
    this._initDefs();
  }

  _initDefs() {
    // Set viewBox on svg
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Create defs for filters and gradients if not present
    let defs = this.svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
        <filter id="cyan-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="red-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="grid-dots" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1" fill="#1f2d42" />
        </pattern>
      `;
      this.svg.appendChild(defs);
    }
  }

  setData(snapshot) {
    if (!snapshot) return;
    this.nodes = snapshot.nodes || [];
    this.roads = snapshot.roads || [];
    this.teams = snapshot.teams || [];
    this.emergencies = snapshot.emergencies || [];
    this.assignments = snapshot.assignments || [];

    this._computeProjections();
    this.render();
  }

  _computeProjections() {
    if (this.nodes.length === 0) return;

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    this.nodes.forEach(n => {
      if (n.lat < minLat) minLat = n.lat;
      if (n.lat > maxLat) maxLat = n.lat;
      if (n.lon < minLon) minLon = n.lon;
      if (n.lon > maxLon) maxLon = n.lon;
    });

    const latSpan = (maxLat - minLat) || 0.01;
    const lonSpan = (maxLon - minLon) || 0.01;

    const usableWidth = this.width - this.padding.left - this.padding.right;
    const usableHeight = this.height - this.padding.top - this.padding.bottom;

    this.nodeCoords.clear();
    this.nodes.forEach(n => {
      // Longitude: West -> East (left -> right)
      const x = this.padding.left + ((n.lon - minLon) / lonSpan) * usableWidth;
      // Latitude: North -> South (top -> bottom, inverted)
      const y = this.height - this.padding.bottom - ((n.lat - minLat) / latSpan) * usableHeight;
      this.nodeCoords.set(n.id, { x, y });
    });
  }

  render() {
    // Preserve defs
    const defs = this.svg.querySelector('defs');
    this.svg.innerHTML = '';
    if (defs) this.svg.appendChild(defs);

    // Background tactical grid
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', 'url(#grid-dots)');
    this.svg.appendChild(bgRect);

    // Layer groups for strict visual z-ordering
    const roadsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    roadsGroup.setAttribute('id', 'layer-roads');
    this.svg.appendChild(roadsGroup);

    const routesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    routesGroup.setAttribute('id', 'layer-routes');
    this.svg.appendChild(routesGroup);

    const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodesGroup.setAttribute('id', 'layer-nodes');
    this.svg.appendChild(nodesGroup);

    const teamsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    teamsGroup.setAttribute('id', 'layer-teams');
    this.svg.appendChild(teamsGroup);

    // 1. Render Roads
    this.roads.forEach(road => {
      const uCoord = this.nodeCoords.get(road.u);
      const vCoord = this.nodeCoords.get(road.v);
      if (!uCoord || !vCoord) return;

      const isBlocked = road.status === 'BLOCKED';

      // Edge line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', uCoord.x);
      line.setAttribute('y1', uCoord.y);
      line.setAttribute('x2', vCoord.x);
      line.setAttribute('y2', vCoord.y);
      line.setAttribute('class', `svg-edge ${isBlocked ? 'blocked' : 'open'}`);
      line.dataset.roadId = road.id;

      // Click to toggle
      line.addEventListener('click', () => {
        if (this.onRoadClick) this.onRoadClick(road);
      });

      // Hover tooltip
      line.addEventListener('mouseenter', (e) => {
        this._showTooltip(e, `
          <strong>Road ${road.id}</strong><br>
          From: ${road.u} &rarr; ${road.v}<br>
          Distance: ${road.distanceKm} km<br>
          Status: <span style="color: ${isBlocked ? '#ef4444' : '#10b981'}; font-weight: bold;">${road.status}</span><br>
          <em>Click to toggle block</em>
        `);
      });
      line.addEventListener('mousemove', (e) => this._moveTooltip(e));
      line.addEventListener('mouseleave', () => this._hideTooltip());

      roadsGroup.appendChild(line);

      // Edge distance label
      const midX = (uCoord.x + vCoord.x) / 2;
      const midY = (uCoord.y + vCoord.y) / 2;

      // Subtle angle offset for road label
      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      labelBg.setAttribute('x', midX - 22);
      labelBg.setAttribute('y', midY - 9);
      labelBg.setAttribute('width', 44);
      labelBg.setAttribute('height', 18);
      labelBg.setAttribute('class', 'svg-edge-label-bg');
      roadsGroup.appendChild(labelBg);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', midX);
      label.setAttribute('y', midY);
      label.setAttribute('class', 'svg-edge-label');
      if (isBlocked) {
        label.setAttribute('fill', '#ef4444');
        label.textContent = '⛔ BLOCKED';
      } else {
        label.textContent = `${road.distanceKm}km`;
      }
      roadsGroup.appendChild(label);
    });

    // 2. Render Active Dijkstra Routes
    this.assignments.forEach(asg => {
      if (asg.status === 'COMPLETED' || !asg.routeNodes || asg.routeNodes.length < 2) return;

      const points = [];
      for (const nodeId of asg.routeNodes) {
        const coord = this.nodeCoords.get(nodeId);
        if (coord) points.push(`${coord.x},${coord.y}`);
      }

      if (points.length >= 2) {
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', points.join(' '));
        polyline.setAttribute('class', 'svg-route-active');
        polyline.dataset.asgId = asg.id;

        polyline.addEventListener('mouseenter', (e) => {
          this._showTooltip(e, `
            <strong style="color: #00e5ff;">Active Shortest Route</strong><br>
            Assignment: ${asg.id}<br>
            Unit: ${asg.teamId} &rarr; Incident: ${asg.emergencyId}<br>
            Path: ${asg.routeNodes.join(' &rarr; ')}<br>
            Total Distance: ${asg.routeDistanceKm} km
          `);
        });
        polyline.addEventListener('mousemove', (e) => this._moveTooltip(e));
        polyline.addEventListener('mouseleave', () => this._hideTooltip());

        routesGroup.appendChild(polyline);
      }
    });

    // 3. Render Nodes
    this.nodes.forEach(node => {
      const coord = this.nodeCoords.get(node.id);
      if (!coord) return;

      // Check if there are active emergencies at this node
      const nodeEmergencies = this.emergencies.filter(
        e => e.nodeId === node.id && e.status !== 'COMPLETED'
      );
      const hasEmergency = nodeEmergencies.length > 0;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `svg-node-group ${hasEmergency ? 'svg-node-has-emergency' : ''}`);
      group.dataset.nodeId = node.id;

      // Pulse ring for emergencies
      if (hasEmergency) {
        const pulseRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        pulseRing.setAttribute('cx', coord.x);
        pulseRing.setAttribute('cy', coord.y);
        pulseRing.setAttribute('r', '22');
        pulseRing.setAttribute('fill', 'none');
        pulseRing.setAttribute('stroke', '#ef4444');
        pulseRing.setAttribute('stroke-width', '2');
        pulseRing.setAttribute('opacity', '0.7');
        group.appendChild(pulseRing);
      }

      // Base Node circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', coord.x);
      circle.setAttribute('cy', coord.y);
      circle.setAttribute('r', '14');
      circle.setAttribute('class', 'svg-node-circle');
      group.appendChild(circle);

      // Node label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', coord.x);
      label.setAttribute('y', coord.y + 26);
      label.setAttribute('class', 'svg-node-label');
      label.textContent = node.id.replace(/_/g, ' ');
      group.appendChild(label);

      // Click callback
      group.addEventListener('click', () => {
        if (this.onNodeClick) this.onNodeClick(node);
      });

      // Hover Tooltip
      group.addEventListener('mouseenter', (e) => {
        let emInfo = 'None';
        if (hasEmergency) {
          emInfo = nodeEmergencies.map(em => `
            <span style="color: #ef4444; font-weight: bold;">[${em.priority}] ${em.type} (${em.id})</span> - Injured: ${em.injured}
          `).join('<br>');
        }

        this._showTooltip(e, `
          <strong style="color: #38bdf8;">${node.id}</strong><br>
          Coordinates: ${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}<br>
          Emergencies at Node: ${emInfo}<br>
          <em>Click to select in Dispatch Form</em>
        `);
      });
      group.addEventListener('mousemove', (e) => this._moveTooltip(e));
      group.addEventListener('mouseleave', () => this._hideTooltip());

      nodesGroup.appendChild(group);
    });

    // 4. Render Response Teams (Vehicles)
    // Group teams by nodeId to offset overlapping icons
    const teamsByNode = new Map();
    this.teams.forEach(t => {
      const list = teamsByNode.get(t.nodeId) || [];
      list.push(t);
      teamsByNode.set(t.nodeId, list);
    });

    teamsByNode.forEach((teamList, nodeId) => {
      const coord = this.nodeCoords.get(nodeId);
      if (!coord) return;

      teamList.forEach((team, idx) => {
        const offsetAngle = (idx * (2 * Math.PI / teamList.length)) - (Math.PI / 2);
        const radius = teamList.length > 1 ? 26 : 0;
        const tx = coord.x + radius * Math.cos(offsetAngle);
        const ty = coord.y + radius * Math.sin(offsetAngle) - 18;

        const teamG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        teamG.setAttribute('class', 'svg-team-badge');
        teamG.setAttribute('transform', `translate(${tx}, ${ty})`);

        // Badge background
        const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badgeBg.setAttribute('x', -18);
        badgeBg.setAttribute('y', -12);
        badgeBg.setAttribute('width', 36);
        badgeBg.setAttribute('height', 24);
        badgeBg.setAttribute('rx', 6);
        badgeBg.setAttribute('ry', 6);

        let strokeColor = '#10b981';
        if (team.status === 'BUSY') strokeColor = '#f59e0b';
        if (team.status === 'OFFLINE') strokeColor = '#64748b';

        badgeBg.setAttribute('fill', '#09101d');
        badgeBg.setAttribute('stroke', strokeColor);
        badgeBg.setAttribute('stroke-width', '2');
        teamG.appendChild(badgeBg);

        // Icon + ID text
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 0);
        text.setAttribute('y', 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '10px');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('font-family', 'var(--font-mono)');
        text.setAttribute('fill', '#ffffff');
        text.textContent = team.id;
        teamG.appendChild(text);

        // Hover tooltip
        teamG.addEventListener('mouseenter', (e) => {
          let icon = '🚑';
          if (team.type === 'FIRE_BRIGADE') icon = '🚒';
          if (team.type === 'RESCUE_TEAM') icon = '🛟';

          this._showTooltip(e, `
            <strong>${icon} Unit ${team.id} (${team.type})</strong><br>
            Status: <span style="color:${strokeColor}; font-weight:bold;">${team.status}</span><br>
            Current Station/Node: ${team.nodeId}<br>
            Active Mission: ${team.activeAssignmentId || 'None'}
          `);
        });
        teamG.addEventListener('mousemove', (e) => this._moveTooltip(e));
        teamG.addEventListener('mouseleave', () => this._hideTooltip());

        teamsGroup.appendChild(teamG);
      });
    });
  }

  _showTooltip(e, html) {
    if (!this.tooltip) return;
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = 'block';
    this._moveTooltip(e);
  }

  _moveTooltip(e) {
    if (!this.tooltip || this.tooltip.style.display !== 'block') return;
    const offset = 14;
    const parentRect = this.svg.parentElement.getBoundingClientRect();
    const x = e.clientX - parentRect.left + offset;
    const y = e.clientY - parentRect.top + offset;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  _hideTooltip() {
    if (!this.tooltip) return;
    this.tooltip.style.display = 'none';
  }
}

window.CityGraphRenderer = CityGraphRenderer;
