import PhotoSwipeLightbox from '/vendor/photoswipe/photoswipe-lightbox.esm.min.js';

// Items whose size is unknown: derive from the loaded thumbnail's aspect ratio.
document.querySelectorAll('a[data-autosize] img').forEach((img) => {
  const set = () => {
    if (!img.naturalWidth) return;
    const a = img.closest('a');
    a.dataset.pswpWidth = 2000;
    a.dataset.pswpHeight = Math.round((2000 * img.naturalHeight) / img.naturalWidth);
  };
  if (img.complete) set(); else img.addEventListener('load', set);
});

document.querySelectorAll('.pswp-gallery').forEach((el) => {
  const lightbox = new PhotoSwipeLightbox({
    gallery: el,
    children: 'a.g-item',
    pswpModule: () => import('/vendor/photoswipe/photoswipe.esm.min.js'),
    bgOpacity: 0.96,
    wheelToZoom: true,
    showHideAnimationType: 'zoom',
    secondaryZoomLevel: 2,
    maxZoomLevel: 4,
    preload: [1, 2],
  });
  lightbox.on('uiRegister', () => {
    lightbox.pswp.ui.registerElement({
      name: 'custom-caption',
      order: 9,
      isButton: false,
      appendTo: 'root',
      onInit: (node, pswp) => {
        pswp.on('change', () => {
          const a = pswp.currSlide.data.element;
          const cap = a && a.querySelector('.pswp-caption-content');
          node.textContent = cap ? cap.textContent : '';
        });
      },
    });
  });
  lightbox.init();
});
