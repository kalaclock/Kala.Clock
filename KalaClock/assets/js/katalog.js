/**
 * KALA.CLOCK — JAVASCRIPT CONTROLLER KATALOG PRODUK
 * Menangani:
 * 1. Mobile Swipe Carousel (Touch Gesture & Arrow Buttons)
 * 2. Indicator Dots Synchronization
 * 3. Responsive Resize Handler
 */

document.addEventListener('DOMContentLoaded', function () {
  const container = document.getElementById('katalogCardsContainer');
  const cards = document.querySelectorAll('.katalog-card');
  const prevBtn = document.getElementById('carouselPrevBtn');
  const nextBtn = document.getElementById('carouselNextBtn');
  const dots = document.querySelectorAll('.carousel-dot');

  if (!container || cards.length === 0) return;

  let currentSlide = 0;
  const totalSlides = cards.length;
  let isMobileView = window.innerWidth <= 860;

  // Touch Gesture Variables
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let isDragging = false;
  let currentTranslate = 0;
  let prevTranslate = 0;

  function updateCarousel(slideIndex, animated = true) {
    if (slideIndex < 0) slideIndex = 0;
    if (slideIndex >= totalSlides) slideIndex = totalSlides - 1;

    currentSlide = slideIndex;

    if (isMobileView) {
      const cardWidth = container.clientWidth;
      const gap = 16; // gap in px defined in CSS
      const offset = currentSlide * (cardWidth + gap);

      container.style.transition = animated ? 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
      container.style.transform = `translateX(-${offset}px)`;

      // Update Dots
      dots.forEach((dot, idx) => {
        if (idx === currentSlide) {
          dot.classList.add('active');
          dot.setAttribute('aria-selected', 'true');
        } else {
          dot.classList.remove('active');
          dot.setAttribute('aria-selected', 'false');
        }
      });

      // Update Button State (optional subtle opacity)
      if (prevBtn) {
        prevBtn.style.opacity = currentSlide === 0 ? '0.4' : '1';
        prevBtn.style.pointerEvents = currentSlide === 0 ? 'none' : 'auto';
      }
      if (nextBtn) {
        nextBtn.style.opacity = currentSlide === totalSlides - 1 ? '0.4' : '1';
        nextBtn.style.pointerEvents = currentSlide === totalSlides - 1 ? 'none' : 'auto';
      }
    } else {
      // Desktop: Reset transform
      container.style.transform = 'none';
      container.style.transition = 'none';
    }
  }

  // Navigation Arrow Click Handlers
  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      if (currentSlide > 0) {
        updateCarousel(currentSlide - 1);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      if (currentSlide < totalSlides - 1) {
        updateCarousel(currentSlide + 1);
      }
    });
  }

  // Dot Click Handlers
  dots.forEach((dot) => {
    dot.addEventListener('click', function () {
      const targetIndex = parseInt(this.getAttribute('data-slide'), 10);
      if (!isNaN(targetIndex)) {
        updateCarousel(targetIndex);
      }
    });
  });

  // Touch Event Handlers for Mobile Swipe
  container.addEventListener('touchstart', function (e) {
    if (!isMobileView) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  container.addEventListener('touchmove', function (e) {
    if (!isDragging || !isMobileView) return;
    touchEndX = e.touches[0].clientX;
    touchEndY = e.touches[0].clientY;

    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Check if horizontal swipe is dominant
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      const cardWidth = container.clientWidth;
      const gap = 16;
      const baseOffset = currentSlide * (cardWidth + gap);
      const dragOffset = baseOffset - deltaX * 0.7; // resist drag
      container.style.transition = 'none';
      container.style.transform = `translateX(-${dragOffset}px)`;
    }
  }, { passive: true });

  container.addEventListener('touchend', function () {
    if (!isDragging || !isMobileView) return;
    isDragging = false;

    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 45; // Minimum px to trigger slide

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX < 0 && currentSlide < totalSlides - 1) {
        // Swiped Left -> Next Card
        updateCarousel(currentSlide + 1);
      } else if (deltaX > 0 && currentSlide > 0) {
        // Swiped Right -> Prev Card
        updateCarousel(currentSlide - 1);
      } else {
        // Snap back
        updateCarousel(currentSlide);
      }
    } else {
      // Snap back if threshold not met
      updateCarousel(currentSlide);
    }

    touchStartX = 0;
    touchEndX = 0;
  });

  // Keyboard Arrow Navigation
  document.addEventListener('keydown', function (e) {
    if (!isMobileView) return;
    if (e.key === 'ArrowLeft' && currentSlide > 0) {
      updateCarousel(currentSlide - 1);
    } else if (e.key === 'ArrowRight' && currentSlide < totalSlides - 1) {
      updateCarousel(currentSlide + 1);
    }
  });

  // Window Resize Handler
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      const wasMobile = isMobileView;
      isMobileView = window.innerWidth <= 860;
      updateCarousel(currentSlide, false);
    }, 100);
  });

  // Initial setup
  updateCarousel(0, false);
});
