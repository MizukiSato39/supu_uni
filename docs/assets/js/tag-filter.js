// ===========================
//  タグフィルター（全テーマ共通）
//  data-tag 属性で動作
// ===========================

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const tagButtons = document.querySelectorAll('[data-tag-btn]');
    const postCards  = document.querySelectorAll('[data-post-tags]');

    if (!tagButtons.length) return;

    tagButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const selectedTag = btn.getAttribute('data-tag-btn');

        // アクティブクラスをトグル
        tagButtons.forEach(function (b) {
          b.classList.remove('word-tag-active', 'cosmic-tag-active', 'term-tag-active');
        });
        btn.classList.add(
          btn.classList.contains('cosmic-tag') ? 'cosmic-tag-active' :
          btn.classList.contains('term-tag')   ? 'term-tag-active'   :
          'word-tag-active'
        );

        // 記事の表示/非表示
        postCards.forEach(function (card) {
          const tags = (card.getAttribute('data-post-tags') || '').split(',');
          if (selectedTag === '__all__' || tags.includes(selectedTag)) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  });
})();
