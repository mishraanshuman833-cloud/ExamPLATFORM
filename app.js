document.addEventListener("DOMContentLoaded", () => {
    // Smooth navigation for internal links
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
            const targetId = link.getAttribute("href");

            if (!targetId || targetId === "#") {
                return;
            }

            const target = document.querySelector(targetId);

            if (target) {
                event.preventDefault();

                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            }
        });
    });

    // Coming Soon buttons
    document.querySelectorAll(".exam-card button").forEach((button) => {
        button.addEventListener("click", () => {
            const examCard = button.closest(".exam-card");
            const examName = examCard?.querySelector("h3")?.textContent?.trim();

            if (!examName) {
                return;
            }

            const originalText = button.textContent;

            button.textContent = "Coming Soon...";
            button.disabled = true;

            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
            }, 1500);
        });
    });

    // Small console confirmation for development
    console.log("ExamPlatform loaded successfully.");
});