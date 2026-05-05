document.addEventListener('DOMContentLoaded', () => {
    const card = document.querySelector('.glass-card');
    
    // Simple 3D tilt effect on mouse move
    document.addEventListener('mousemove', (e) => {
        const xAxis = (window.innerWidth / 2 - e.pageX) / 50;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 50;
        
        // Apply transform only if device supports hover (not touch)
        if (window.matchMedia("(hover: hover)").matches) {
            card.style.transform = `translateY(0) rotateY(${xAxis}deg) rotateX(${yAxis}deg)`;
        }
    });

    // Reset transform on mouse leave
    document.addEventListener('mouseleave', () => {
        card.style.transform = `translateY(0) rotateY(0deg) rotateX(0deg)`;
    });
    
    card.parentElement.style.perspective = '1000px';
});
